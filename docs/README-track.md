# README 追踪字段说明

> 最后更新：2026-06-05
> 配套：`.claude/scripts/scan.sh`

`repository/README.md` 和 `test_project/README.md` 的第 5 列「追踪」用于**指定项目的关注目录**。scan.sh 会在 track/ 目录不存在时建立软链接，并在变更报告里追加"关注路径变更追踪"章节。

## 字段格式

| 写法 | 含义 |
|------|------|
| 空 | 不追踪（默认） |
| `version/` | 追踪 `version/` 目录 |
| `version/,apps/api/prisma/migrations` | 多路径，逗号分隔 |

值为**相对仓库根的路径**，指向**目录**。

## 软链接布局

`test_project/<project>/track/<原路径>` 软链接到 `repository/<project>/<原路径>`：

```
test_project/01-oa-llm/
└── track/
    └── version -> ../../../repository/01-oa-llm/version
```

- **保留原路径结构**：`track/version/`、`track/apps/api/prisma/migrations/`
- **零拷贝**：软链接，目标更新自动同步
- **本机独占**：测试工程目录不提交，软链接跨机器无意义，**无需 gitignore**

## 重建规则

- **track/ 目录不存在** → scan.sh 按当前追踪字段建立软链接
- **track/ 目录已存在** → scan.sh **跳过**（不做任何修改）
- **想重建**：手动 `rm -rf test_project/<project>/track/`，下次 scan.sh 自动重建
- **想修改追踪路径**：先 `rm -rf track/`，再改 README 第 5 列，下次 scan.sh 按新路径建

**为什么不是每次扫描重建**：避免误删用户在 track/ 下创建的非软链接文件；保护"一次建立、自动同步"的设计意图（仓库内容变了，链接自动跟着变）。

## 平台差异

| 平台 | 实现方式 | 备注 |
|------|---------|------|
| Linux / macOS | `ln -s` | 直接生效 |
| Windows git bash | 优先 `ln -s` | 失败时 fallback 到 `cmd.exe //c mklink /D` |
| Windows cmd / PowerShell | `mklink /D` | 需要开启"开发人员模式"或管理员权限 |

## 行为约束

1. **空字段 = 不追踪**
2. **目标在仓库中不存在** → 记录 WARN，跳过该路径，不阻断扫描
3. **track/ 下用户放的真实文件** → 永远不会被动到（只建软链接，不删）
4. **多级目录自动支持**：`apps/api/prisma/migrations` 会建出 `track/apps/api/prisma/migrations`

## 报告示例

整体有变更时，reports 末尾追加：

```markdown
---

## 关注路径变更追踪

本项目在 `repository/README.md` 中标记了以下关注路径，扫描时按路径单独统计。
软链接位于 `test_project/01-oa-llm/track/` 下，每次扫描时按当前模式重新生成。

### `version/`

- `version/v0.0.3/migrate_v0.0.3.sql`
- `version/v0.0.3/update_readme.md`

### `apps/api/prisma/migrations`

本次扫描无变更
```

## 维护操作

- **新增关注路径**：先 `rm -rf test_project/<project>/track/`，再改 README 第 5 列，下次 scan.sh 按新路径建
- **删除某个关注路径**：先 `rm -rf test_project/<project>/track/`，再从 README 移除对应项
- **重建全部软链接**：`rm -rf test_project/<project>/track/` → 下次 scan.sh 自动重建
- **停用追踪**：清空 README 第 5 列 → 下次 scan.sh 不创建 track/ 目录（已有目录也不动）
