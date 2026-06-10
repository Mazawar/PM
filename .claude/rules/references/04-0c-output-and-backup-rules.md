# 04-0c 产出文件与备份规则

> 所属：04-deployer 子规则

## 产出文件

### environment.json.build 段

```json
{
  "build": {
    "mode": "local|remote",
    "builtAt": "ISO",
    "remote": {
      "deployPath": "/home/ubuntu/projects/<NN-Project>"
    }
  }
}
```

**注意**：`archive` 和 `archivedAt` 字段由 validator 在环境验证通过并归档后写入，deployer 不写归档相关字段。

### 部署验证报告

在 `test_project/<NN-Project>/results/.build/deploy/` 下写 `progress.txt` 和 `report.md`。

**progress.txt**：
```
DEPLOY-001:PASS
DEPLOY-002:FAIL
DEPLOY-003:SKIP
...
```

**report.md**：
```markdown
# <NN-Project> 部署验证报告

## 概要
- 验证时间: <YYYY-MM-DD HH:mm>
- 部署模式: <local|remote>
- 验证结果: <通过数>/<总数>

## 结果概览
| 编号 | 检查项 | 结果 | 备注 |
|------|--------|------|------|

## 详细结果
### DEPLOY-NNN: <检查项> - PASS/FAIL/SKIP
**执行**: ...
**预期**: ...
**实际**: ...
**错误日志**: ...（仅 FAIL）
```

### 其他辅助文件

- `build/version-log.json` — 构建版本追踪（追加记录）
- `build/deploy-config.json` — 远程部署配置快照（mode=remote）
- `build/nginx.conf` — Nginx 配置副本（有前端时）
- `build/backups/backup-manifest.json` — 本地备份清单（仅元数据）

## 备份机制

### 本地备份（DEPLOY-003 前）

覆盖 `build/dev/` 前检查已有产物：
1. `build/dev/backend/.env` 存在 → 复制到 `build/backups/pre-deploy-<timestamp>/backend.env.bak`
2. 写入 `build/backups/backup-manifest.json` 追加一条记录
3. 清理超过 5 份的旧备份

### 远程备份（DEPLOY-009 前）

见 04-0b DEPLOY-009 执行细节。备份存储在 `/var/backups/pm/<NN-Project>/`，由 SSH backup 工具管理。

### 备份清单格式（manifest.json）

```json
{
  "project": "<NN-Project>",
  "backups": [
    {
      "id": "pre-deploy-20260608-165200",
      "timestamp": "ISO",
      "trigger": "deploy",
      "previousCommit": "7da12b0c",
      "contents": { "database": true, "configFiles": ["backend/.env"] },
      "location": "local | remote"
    }
  ],
  "maxBackups": 5
}
```

### 回滚（用户触发）

用户说"回滚"时 → 主会话列出备份 → 用户选择 → deployer mode=rollback 执行：
- 恢复数据库：`ssh_backup_restore(server, backupId, database=<db>)`
- 恢复配置：从备份目录复制 `.env` 回 `<deployPath>/backend/`
- 重启服务
