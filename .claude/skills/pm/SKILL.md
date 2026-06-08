---
name: pm
description: |
  Manage project registrations. Add new projects (interactive prompts for name,
  URL; type auto-detected from URL), delete existing projects (requires name +
  confirmation), or list all registered projects. Updates both registry files atomically.
argument-hint: "[add [name] [url]|del <name>|list|track <name> [paths]]"
allowed-tools: Read, Edit, Write, AskUserQuestion, Bash
---

# Project Registry Manager

Manage projects in two registry files:
- `repository/README.md` — project source registry
- `test_project/README.md` — test project registry

Both use `<!-- projects-start -->` / `<!-- projects-end -->` markers. Only edit within markers.

## 表格格式规范（强制）

标记区域内的内容**必须严格遵循以下格式**，确保 Markdown 表格正确渲染：

```markdown
<!-- projects-start -->

| 编号 | 地址 | 仓库 | 类型 | 追踪 |
| --- | --- | --- | --- | --- |
| 01-RuoYi-Vue | ./01-RuoYi-Vue | ... | Git | |

<!-- projects-end -->
```

格式规则：
- `<!-- projects-start -->` 后**必须有一个空行**，再接表头
- 表头行、分隔行、数据行之间**无空行**
- 最后一条数据行与 `<!-- projects-end -->` 之间**必须有一个空行**
- **写入前先读取当前文件**，用 Edit 的 `old_string` 精确匹配现有内容（含空行），确保替换后格式一致

## Parse Arguments

Determine action from **$ARGUMENTS**:

| Arguments | Action |
|-----------|--------|
| `add [name] [url]` | → Add flow (name/url/tracking optional, asked if missing) |
| `del <name>` or `delete <name>` or `rm <name>` | → Delete flow (name required) |
| `list` or `ls` or empty | → List flow |
| `track <name> [paths...]` | → Track flow (modify tracking field + rebuild symlinks) |

---

## add — Add a New Project

### Step 1: Collect Project Info

Parse `$ARGUMENTS` to extract any provided info:
- **Name**: If arguments contain a name after `add` (e.g., `/pm add minions`), use it directly.
- **URL**: If arguments look like a URL or path (e.g., `/pm add minions https://gitee.com/user/minions`), extract it.

Ask **only** for missing info using **AskUserQuestion**:

1. **项目名称** — Only ask if NOT provided in arguments. Short project name (e.g., `RuoYi-Vue`, `MyApp`). Letters, digits, hyphens only. No number prefix — auto-assigned.
2. **仓库地址** — Only ask if NOT provided in arguments. Full URL or local path. Use free-text input (user selects "Other" to type URL).
3. **追踪目录** — Only ask if NOT provided in arguments. **追踪目录** are 仓库内目录路径，用于在测试工程下建立软链接，方便随时浏览（不会被注册表管理）。多个目录用逗号分隔。常见用例：`version/`（版本说明）、`docs/`（文档）。空 = 不追踪。
   - 留空 / 不填 → 字段为空，scan.sh 不会创建 track/ 目录
   - 填 `version/` → 软链接到 `test_project/<project>/track/version/`
   - 填 `version/,docs/` → 多个软链接
   - 填好后**不立即建软链接**：scan.sh 下次扫描时如果 `track/` 目录不存在才建；如果想立刻建，扫一次 `bash .claude/scripts/scan.sh` 或用 `/pm track` 命令

**DO NOT ask for port or credentials** — 这些在测试前环境检查时由 analyzer agent 推断。

**DO NOT ask for project type** — auto-detect from the address:
- URL ending in `.git` or matching `github.com` / `gitee.com` / `gitlab.com` → **Git**
- URL starting with `svn://` or containing `/svn/` → **SVN**
- Absolute local path (e.g., `D:/...`, `/home/...`) → **Local**
- Default: **Git**

Show the auto-detected type in the report for user to verify.

### Step 2: Calculate Number

1. Read `repository/README.md`
2. Parse all existing entries in the `<!-- projects-start -->` table
3. Find the max number N (e.g., `01-RuoYi-Vue` → N=1)
4. New number = N+1, zero-padded to 2 digits (e.g., `02`)
5. Full entry name = `{NN}-{项目名称}` (e.g., `02-MyApp`)

### Step 3: Validate

- Check the new entry name does NOT already exist in either registry
- If it exists, stop and inform the user

### Step 4: Create Project Directories

Create directory structure only:

```bash
mkdir -p test_project/{NN}-{Name}/{test-config/plans,tests/{unit,api,e2e,ui},results,scan-logs}
```

**不创建** `playwright.config.ts` 和 `environment.json`，这些由 analyzer agent 在测试前环境检查时按需生成。

### Step 5: Write to Both Registries

**`repository/README.md`** — insert row at end of table (before `<!-- projects-end -->`):

```
| {NN}-{Name} | ./{NN}-{Name} | {URL} | {Type} | {Track} |
```

**`test_project/README.md`** — insert row at end of table (before `<!-- projects-end -->`):

```
| {NN}-{Name} | ../repository/{NN}-{Name} | {URL} | {Type} | {Track} |
```

Note the address column differs: repository uses `./`, test_project uses `../repository/`.
{Track} 留空时第 5 列也留空（`| |` 末位空字段），不要写 `null` 或 `none`。

### Step 6: Scan

立即执行扫描，克隆仓库并建立追踪软链接：

```bash
bash .claude/scripts/scan.sh {Name}
```

扫描会自动完成：克隆仓库到 `repository/{NN}-{Name}/`、建立 track/ 软链接（如有追踪目录）。

### Step 7: Report

Output a summary:

```
✓ 项目已添加: {NN}-{Name}

| 文件 | 内容 |
|------|------|
| repository/README.md | {NN}-{Name} \| ./{NN}-{Name} \| {URL} \| {Type} \| {Track} |
| test_project/README.md | {NN}-{Name} \| ../repository/{NN}-{Name} \| {URL} \| {Type} \| {Track} |

仓库已克隆{如果填了追踪目录}，追踪软链接已建立}。
测试前环境检查时将自动启动 analyzer / deployer / validator 三段 agent 配置环境，已配置则跳过。
```

---

## del — Delete a Project

### Step 1: Validate Argument

- The project name MUST be provided as argument (e.g., `/pm del 01-RuoYi-Vue` or `/pm del RuoYi-Vue`)
- If no name provided, stop with error: `用法: /pm del <项目名称>`

### Step 2: Find in Registry

1. Read `repository/README.md`
2. Search for the project name in the table (match partial: `RuoYi-Vue` matches `01-RuoYi-Vue`)
3. If not found, stop with error: `未找到项目: {name}`

### Step 3: Confirm

Use **AskUserQuestion** to confirm deletion:

```
确认删除项目 {NN}-{Name}？
```

Options:
- `仅移除注册` — 从两个注册表中移除，仓库目录和测试产物保留在磁盘上
- `彻底清理` — 从注册表移除 + 删除仓库目录 + 删除测试产物目录（不可恢复）
- `取消`

If cancelled, stop with `已取消。`

### Step 4: Remove from Both Registries

Remove the matching row from:
- `repository/README.md`
- `test_project/README.md`

### Step 5: Cleanup (if 彻底清理)

If user chose `彻底清理`, delete physical directories:

```bash
rm -rf repository/{NN}-{Name}
rm -rf test_project/{NN}-{Name}
```

Before deletion, list directory sizes for the report:

```bash
du -sh repository/{NN}-{Name} 2>/dev/null
du -sh test_project/{NN}-{Name} 2>/dev/null
```

If directories don't exist (already deleted or never cloned), skip silently.

### Step 6: Report

**仅移除注册:**
```
✓ 项目已移除: {NN}-{Name}

已从以下文件中删除:
- repository/README.md
- test_project/README.md

注意：仓库目录、测试产物仍保留在磁盘上，需手动清理。
```

**彻底清理:**
```
✓ 项目已彻底清理: {NN}-{Name}

已从以下文件中删除:
- repository/README.md
- test_project/README.md

已删除目录:
- repository/{NN}-{Name}/ ({size})
- test_project/{NN}-{Name}/ ({size})
```

---

## list — List Projects

### Step 1: Read Registry

Read `repository/README.md` and parse the table within `<!-- projects-start -->` / `<!-- projects-end -->`.

### Step 2: Display

Output the project list as a formatted table:

```
## 已注册项目 ({N} 个)

| 编号 | 项目 | 地址 | 类型 | 追踪 |
|------|------|------|------|------|
| 01 | RuoYi-Vue | https://gitee.com/y_project/RuoYi-Vue | Git | version/ |
```

If no projects registered: `暂无已注册项目。`

如果项目特别多，追踪列可能很长，可以加 `（使用 /pm track 修改）` 提示。

---

## track — Modify Tracking Field for an Existing Project

修改已注册项目的「追踪」字段，**并立即重建** `test_project/<NN-Name>/track/` 下的软链接。

### Usage

```
/pm track <name> [paths...]
/pm track <name> --clear
```

| Arguments | Behavior |
|-----------|----------|
| `/pm track 01-oa-llm version/,docs/` | 设置追踪字段为 `version/,docs/`，**删旧 track/ 重建软链接** |
| `/pm track 01-oa-llm` | 留空 = 等同 `--clear`（清空追踪字段） |
| `/pm track 01-oa-llm --clear` | 清空追踪字段，删 track/ 目录（如果有） |

支持**部分项目名**（如 `oa-llm` 匹配 `01-oa-llm`）。

### Step 1: Parse Arguments

从 `$ARGUMENTS` 提取：
- `name` — 必填，位置参数 1
- `paths` — 位置参数 2+（空格分隔），**会自动用逗号拼接**
- `--clear` — 显式清空标志

示例：
- `/pm track oa-llm version/ docs/` → paths = `version/,docs/`
- `/pm track oa-llm` → paths = ``（空），等同于 clear

### Step 2: Find Project in Registry

1. 读 `repository/README.md`
2. 模糊匹配：项目编号列含 `name`（支持 `oa-llm` 匹配 `01-oa-llm`）
3. 找不到 → 报错退出：`未找到项目: {name}`

### Step 3: Read Current Tracking Field

从当前注册表行里读「追踪」列（旧值）展示给用户确认。

### Step 4: Confirm Change

用 **AskUserQuestion** 确认修改：

```
即将修改项目 {NN}-{Name} 的追踪字段：
  旧值: {旧 tracking 字段}
  新值: {新 tracking 字段}

操作会：
1. 更新 repository/README.md 和 test_project/README.md
2. 删除现有 test_project/{NN}-{Name}/track/ 目录（如有）
3. 重新建立软链接

确认？
```

选项：`确认修改` / `取消`

### Step 5: Update Both Registries

修改对应行第 5 列（新值为空时整列清空）：

- `repository/README.md`
- `test_project/README.md`

两个文件**必须同步**。

### Step 6: Rebuild Symlinks

1. 删除 `test_project/{NN}-{Name}/track/` 目录（如有）
2. **调用 `bash .claude/scripts/scan.sh`** 让 scan.sh 按新字段重建软链接

**为什么用 scan.sh 而不是手动建**：scan.sh 的 `ensure_track_links` 已经处理了"目录不存在才建"的逻辑，是单一入口，避免双份实现漂移。

### Step 7: Report

```
✓ 追踪字段已更新: {NN}-{Name}
  旧值: {旧}
  新值: {新}

软链接已重建（基于新字段）。

track/ 当前内容：
- version -> /d/.../repository/{NN}-{Name}/version
（如果新值为空，提示"已清空追踪字段"）
```
