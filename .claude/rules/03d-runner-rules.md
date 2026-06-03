# runner 工具规则（日常启停服务）

> 配套脚本: `scripts/runner.sh`
> **非 agent**，由主会话在收到「启动/停止/重启 xxx」命令时直接调用

## 命令协议

```bash
bash scripts/runner.sh start <NN-Project>     # 检查端口 → 未占用则执行 start.sh
bash scripts/runner.sh stop <NN-Project>      # 找进程 → kill
bash scripts/runner.sh restart <NN-Project>    # stop + start
bash scripts/runner.sh status <NN-Project>    # 端口 + 进程查询
```

## 不写 environment.json

runner.sh 只操作进程/端口，**不读不写** `environment.json`、`pipeline-state.json`、`build/dev/`。

## 跨平台兼容

端口检查：
- Windows：`netstat -ano | grep ":$PORT " | grep LISTENING`
- Linux：`lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null`

进程查找：
- Windows：`netstat -ano | grep ":$PORT " | grep LISTENING | awk '{print $5}' | head -1`
- Linux：`lsof -Pi :$PORT -sTCP:LISTEN -t`

## 错误处理

| 情况 | 行为 |
|------|------|
| start.sh 不存在 | 报错："dev/ 部署包不存在，请先运行 builder" |
| 端口已被占用 | 提示用户（不自动 kill） |
| 进程未找到 | stop/restart 提示「服务未运行」 |
| start.sh 启动超时 | 检查 `build/dev/logs/*.log` |
