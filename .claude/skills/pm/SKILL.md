---
name: pm
description: |
  Manage project registrations. Add new projects (interactive prompts for name,
  URL; type auto-detected from URL), delete existing projects (requires name +
  confirmation), or list all registered projects. Updates both registry files atomically.
argument-hint: "[add [name] [url]|del <name>|list]"
allowed-tools: Read, Edit, Write, AskUserQuestion, Bash
---

# Project Registry Manager

Manage projects in two registry files:
- `repository/README.md` — project source registry
- `test_project/README.md` — test project registry

Both use `<!-- projects-start -->` / `<!-- projects-end -->` markers. Only edit within markers.

## Parse Arguments

Determine action from **$ARGUMENTS**:

| Arguments | Action |
|-----------|--------|
| `add [name] [url]` | → Add flow (name/url optional, asked if missing) |
| `del <name>` or `delete <name>` or `rm <name>` | → Delete flow (name required) |
| `list` or `ls` or empty | → List flow |

---

## add — Add a New Project

### Step 1: Collect Project Info

Parse `$ARGUMENTS` to extract any provided info:
- **Name**: If arguments contain a name after `add` (e.g., `/pm add minions`), use it directly.
- **URL**: If arguments look like a URL or path (e.g., `/pm add minions https://gitee.com/user/minions`), extract it.

Ask **only** for missing info using **one single AskUserQuestion call**:

1. **项目名称** — Only ask if NOT provided in arguments. Short project name (e.g., `RuoYi-Vue`, `MyApp`). Letters, digits, hyphens only. No number prefix — auto-assigned.
2. **仓库地址** — Only ask if NOT provided in arguments. Full URL or local path. Use free-text input (user selects "Other" to type URL).

**DO NOT ask for port or credentials** — 这些在测试前环境检查时由 Setup Agent 询问。

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
mkdir -p test_project/{NN}-{Name}/{test-config/plans,tests/{unit,api,e2e,ui},results,reports}
```

**不创建** `playwright.config.ts` 和 `environment.json`，这些由 Setup Agent 在测试前环境检查时按需生成。

### Step 5: Write to Both Registries

**`repository/README.md`** — insert row at end of table (before `<!-- projects-end -->`):

```
| {NN}-{Name} | ./{NN}-{Name} | {URL} | {Type} |
```

**`test_project/README.md`** — insert row at end of table (before `<!-- projects-end -->`):

```
| {NN}-{Name} | ../repository/{NN}-{Name} | {URL} | {Type} |
```

Note the address column differs: repository uses `./`, test_project uses `../repository/`.

### Step 6: Report

Output a summary:

```
✓ 项目已添加: {NN}-{Name}

| 文件 | 内容 |
|------|------|
| repository/README.md | {NN}-{Name} \| ./{NN}-{Name} \| {URL} \| {Type} |
| test_project/README.md | {NN}-{Name} \| ../repository/{NN}-{Name} \| {URL} \| {Type} |

下次执行 scan.sh 时将自动克隆仓库。
测试前环境检查时将自动启动 Setup Agent 配置环境（端口、凭据、技术栈分析），已配置则跳过。
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
确认删除项目 {NN}-{Name}？此操作将从两个注册表中移除该项目。
注意：已克隆的仓库目录和测试产物不会被删除。
```

Options: `确认删除` / `取消`

If cancelled, stop with `已取消。`

### Step 4: Remove from Both Registries

Remove the matching row from:
- `repository/README.md`
- `test_project/README.md`

### Step 5: Report

```
✓ 项目已移除: {NN}-{Name}

已从以下文件中删除:
- repository/README.md
- test_project/README.md

注意：仓库目录和测试产物仍保留在磁盘上，需手动清理。
```

---

## list — List Projects

### Step 1: Read Registry

Read `repository/README.md` and parse the table within `<!-- projects-start -->` / `<!-- projects-end -->`.

### Step 2: Display

Output the project list as a formatted table:

```
## 已注册项目 ({N} 个)

| 编号 | 项目 | 地址 | 类型 |
|------|------|------|------|
| 01 | RuoYi-Vue | https://gitee.com/y_project/RuoYi-Vue | Git |
```

If no projects registered: `暂无已注册项目。`
