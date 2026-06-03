# analyzer 远程探测规则

> 配套 agent: `project-manage-analyzer`
> 本地分析见 `03a-analyzer-rules.md`

## 触发条件

**仅在 `environment.json.remoteConfig.server` 非空时执行远程探测。**

- 首次跑 analyzer：主会话在启动前不会预填 remoteConfig，因此首次只做本地分析
- 重绑定切服务器：先清空 `analyzer.remoteProbe` → 重跑 analyzer → 重新探测

## 探测工具

**仅使用 SSH MCP 工具**（`ssh_execute`、`ssh_health_check`、`ssh_monitor`）。禁止用 `Bash` + `ssh`。

## 探测项

按以下顺序探测，结果写入 `environment.json.analyzer.remoteProbe.*`：

| 项 | 命令 | 写入字段 |
|---|------|---------|
| OS | `cat /etc/os-release` | `remoteProbe.os` |
| Node.js | `node --version`（如适用） | `remoteProbe.runtime.node` |
| Java | `java --version`（如适用） | `remoteProbe.runtime.java` |
| Python | `python3 --version`（如适用） | `remoteProbe.runtime.python` |
| MySQL | `mysql --version` + `systemctl is-active mysql` | `remoteProbe.runtime.mysql` |
| PostgreSQL | `psql --version` | `remoteProbe.runtime.postgres` |
| Nginx | `nginx -v` + `systemctl is-active nginx` | `remoteProbe.runtime.nginx` |
| 端口 | `ss -tlnp` 对比 `analyzer.ports` | `remoteProbe.ports.free` / `ports.occupied` |
| 磁盘 | `df -h $HOME` | `remoteProbe.disk` |

## 失败处理

**探测失败不阻断 analyzer 完成。**

- 写 `remoteProbe.error = "<错误描述>"`
- 写 `remoteProbe.warnings = ["<warning-1>", ...]`
- 继续写 `analyzer.completedAt`

## 写入字段

```json
{
  "analyzer": {
    "remoteProbe": {
      "completedAt": "ISO",
      "os": "Ubuntu 22.04",
      "runtime": { "node": "v20.10.0", "mysql": "8.0.35", "nginx": "1.24.0" },
      "ports": { "free": [3000, 5173], "occupied": [] },
      "disk": "20G available",
      "warnings": []
    }
  }
}
```

## 完成后

- analyzer 段 `completedAt` 已写
- 输出 remoteProbe 摘要
- **不安装任何运行时**（安装是 builder 阶段）
- **不上传任何文件**（上传是 builder 阶段）
