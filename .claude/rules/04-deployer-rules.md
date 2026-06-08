# deployer 阶段规则（文档驱动的部署验证）

> 配套 agent: `project-manage-deployer`
> 规则编号：04（上接 03-analyzer，下接 05-validator）

## 核心理念

**我们是测试平台，不是部署工程师。** 项目提供了部署文档和步骤说明，deployer 的职责是：

1. 读取 analyzer 分析结果和项目部署文档
2. **严格按文档步骤执行**
3. 成功 → 出报告，进入下一阶段
4. 失败 → **直接上报**，不猜测、不兜底、不尝试替代方案

**项目部署文档跑不通 = 项目有问题，不是我们的问题。**

## 核心职责

验证项目能否成功部署并具备测试条件。按 `buildMode` 分支：

- **mode=local**：编译 → 归档 → 组装 `build/dev/` → 出部署验证报告
- **mode=remote**：在 local 基础上 + 上传远程 + 配置环境 + 出报告

**禁止**启动服务、做健康检查、更新 baseURL（validator 负责）。

## 触发条件

- `environment.json.analyzer.completedAt` 必须存在
- `environment.json.build.mode` 必须为 `'local'` 或 `'remote'`
- mode=remote 时 `remoteConfig.server` 必须已绑定

## 唯一知识来源：analyzer 结果（强制）

deployer **所有操作**的知识来源只有一个：`environment.json.analyzer`。

| 需要做什么 | 从 analyzer 段取什么 | 没有 → 怎么办 |
|-----------|---------------------|-------------|
| 编译构建 | `deploymentDocs.buildCommand` | 报告缺失，终止 |
| 启动命令 | `deploymentDocs.startCommand` | 报告缺失，终止 |
| 数据库初始化 | `dbConfig.initMethod` + `dbConfig.initFiles` | 无 dbConfig 则跳过 |
| 环境变量 | `deploymentDocs.envVars` | 报告缺失，终止 |
| 目录布局 | `deploymentDocs.directoryLayout` | 报告缺失，终止 |
| 已知问题 | `deploymentDocs.knownIssues` | 提前规避 |

### 禁止行为

- **禁止猜测**构建命令、启动方式、目录结构
- **禁止尝试替代方案**（文档说 pnpm build，就不去试 npm run build）
- **禁止排查修复**（失败就报告，不帮项目修问题）
- **禁止忽略 `knownIssues`** 警告

## 执行流程

### Phase 1：本地构建（local + remote 共用）

#### 1. 编译

在 `repository/<NN-Project>/` 执行 `deploymentDocs.buildCommand`。

- 成功 → 继续
- 失败 → **终止，报告「项目构建失败」**，附上错误日志，不尝试修复

#### 2. 归档

```
build/artifacts/<YYYYMMDD-HHmmss>-<commitShortHash>.tar.gz
build/artifacts/<YYYYMMDD-HHmmss>-<commitShortHash>.manifest.json
```

归档内容：编译产物 + 依赖声明 + ORM schema + .env 模板 + workspace 配置。

禁止包含：`node_modules/`、`version/`、`.git/`、文档、大文件（如 `*.sql` 超过归档用途的）。

#### 3. 组装 build/dev/

```
dev/
├── software/             # 解压归档 + pnpm install
├── database/             # SQL 文件（从仓库按 dbConfig.initFiles 提取，扁平目录）
└── deploy.md             # 部署说明（从 version/*/update_readme.md 合并）
```

步骤：
1. 解压归档到 `build/dev/software/`
2. `pnpm install --config.node-linker=hoisted`
3. Prisma 项目：按 `deploymentDocs.prismaBinaryTargets` 配置 binaryTargets → `npx prisma generate`
4. 组装 `database/`：按 `dbConfig.initFiles` 复制 SQL 到扁平版本目录
5. 生成 `deploy.md`：§1/§4~§10 从 `update_readme.md` 原文复制，§2/§3 按实际结构写入

#### 4. 生成辅助文件

- `build/version-log.json` — 构建版本追踪（追加记录）
- `build/tmp/` — 预创建，保持为空

### Phase 2：远程部署（mode=remote 时追加）

#### SSH 工具选择指南（强制）

**优先使用高层工具，`ssh_execute` 仅作为无对应工具时的兜底。**

| 操作场景 | 首选工具 | 优势 |
|---------|---------|------|
| 系统健康/资源探测 | `ssh_health_check` + `ssh_monitor` | 一次调用获取 CPU/内存/磁盘/网络 |
| 服务状态检查 | `ssh_service_status` | 批量查多个服务 |
| 文件同步到远程 | `ssh_sync`（rsync 增量） | 仅传输变更，替代 tar+upload+extract |
| 配置文件部署 | `ssh_deploy`（带权限+备份） | 自动备份旧文件、设置权限 |
| 数据库备份 | `ssh_backup_create` | 自带压缩、保留期 |
| 查看已有数据库/表 | `ssh_db_list` | 结构化结果，无需拼命令 |
| 导入 SQL 文件 | `ssh_db_import` | 自动处理字符集 |
| 查询验证数据 | `ssh_db_query` | 只读安全，结构化返回 |
| 连续配置命令 | `ssh_session_start` + `ssh_session_send` | 持久会话，减少连接开销 |
| 单条快速命令 | `ssh_execute` | 兜底 |
| 需要 sudo 的命令 | `ssh_execute_sudo` | 兜底 |
| 查看备份历史 | `ssh_backup_list` | 结构化列表 |

**连续操作**（如多步环境配置）使用 `ssh_session` 持久会话；独立操作直接用对应高层工具。

#### 1. 服务器绑定

检查 `remoteConfig`：
- 已绑定 → 直接用
- 未绑定 → 询问用户选择服务器 + 部署路径 → 写入 environment.json

#### 2. 环境探测

使用高层工具一次获取多项指标，**替代多条 `ssh_execute`**：

```
ssh_health_check(server, detailed=true)                         # CPU/内存/磁盘/运行时间
ssh_service_status(server, services=["mysql", "nginx"])         # 批量检查服务
ssh_monitor(server, type="overview")                            # 详细资源概览
```

仅探测不安装。将结果写入 `deploy-config.json.installedComponents`。

#### 3. 缺失组件上报

对比 `deploymentDocs` 要求的运行时版本与探测结果：

- 缺失的组件 → **报告「服务器缺少 xxx，请手动安装」**，附上项目文档要求的版本号
- 用户确认已安装后继续（或提供安装命令让用户选择是否自动执行）

> 注意：首次部署时可选择自动安装基础组件（Node.js、MySQL、Nginx），但**不反复尝试**，一次装不上就报告。

#### 4. 操作前备份（重绑/重部署时）

使用 `ssh_backup_create` 替代手动 `mysqldump`：

```
ssh_backup_create(server, type="mysql", database=<db>, name="pre-deploy-<NN-Project>")
```

- 首次部署可跳过
- 重绑/重部署**必须**备份
- 可用 `ssh_backup_list(server)` 查看历史备份

#### 5. 上传 dev/

使用 `ssh_sync` 增量同步，替代 tar+upload+extract 三步操作：

```
ssh_sync(server, source="local:build/dev/", destination="remote:<deployPath>/dev/",
         compress=true, exclude=["node_modules", "*.log"])
```

- rsync 增量传输，仅发送变更文件
- 验证：`ssh_execute(server, "ls <deployPath>/dev/software/package.json")`

#### 6. 配置环境

使用 `ssh_session` 持久会话执行连续配置命令：

```
session = ssh_session_start(server, name="deploy-config")
ssh_session_send(session, "cd <deployPath>/dev/software && cp .env.development .env")
ssh_session_send(session, "sed -i 's|DATABASE_URL=.*|DATABASE_URL=mysql://...|' .env")
ssh_session_send(session, "grep -c '.' .env")
ssh_session_close(session)
```

按 `deploymentDocs.envVars` 配置 .env，验证所有变量齐备。

#### 7. 初始化数据库

优先使用数据库高层工具，替代手动 `mysql` 命令：

```
# 查看已有数据库
ssh_db_list(server, type="mysql")

# 建库（无对应高层工具，用 execute）
ssh_execute(server, "mysql -u root -e 'CREATE DATABASE IF NOT EXISTS <db> CHARACTER SET utf8mb4'")

# 按 dbConfig.initFiles 顺序导入
ssh_db_import(server, type="mysql", database=<db>, inputFile="<deployPath>/dev/database/<file>.sql")

# 导入 seedFiles
ssh_db_import(server, type="mysql", database=<db>, inputFile="<deployPath>/dev/database/<seed>.sql")

# 验证关键表数据
ssh_db_query(server, type="mysql", database=<db>, query="SELECT COUNT(*) AS cnt FROM <关键表>")
```

失败 → **报告「数据库初始化失败」**，附错误信息，不尝试修复。

#### 8. Nginx 配置（有前端时）

使用 `ssh_deploy` 部署配置文件（自动备份旧配置）：

```
ssh_deploy(server,
  files=[{local: "build/nginx.conf", remote: "/etc/nginx/sites-available/<NN-Project>"}],
  options={backup: true, permissions: "644"})
```

然后验证并重载：

```
ssh_execute_sudo(server, "ln -sf /etc/nginx/sites-available/<NN-Project> /etc/nginx/sites-enabled/")
ssh_execute_sudo(server, "nginx -t")
ssh_execute_sudo(server, "systemctl reload nginx")
```

保存副本到 `build/nginx.conf`。

#### 9. 清理

- 远程临时文件：`ssh_session_start` + `ssh_session_send` 批量删除
- 本地：删除 `build/<NN-Project>/` 副本，`build/tmp/` 清理

## 产出文件

### environment.json.build 段

```json
{
  "build": {
    "mode": "local|remote",
    "version": "v1.0.0",
    "archive": "build/artifacts/<ts>-<commit>.tar.gz",
    "builtAt": "ISO",
    "remote": {
      "installedComponents": { "node": "v20.20.2" },
      "deployPath": "/home/ubuntu/projects/<NN-Project>"
    }
  }
}
```

### deploy-config.json（远程）

```json
{
  "project": "", "server": "", "serverIP": "", "deployPath": "",
  "os": "", "installedComponents": {},
  "ports": {}, "deployTime": "", "verifiedSteps": []
}
```

### version-log.json

每次构建追加一条记录。

## 部署验证报告

完成后在 `results/build/` 下写出：

### progress.txt

```
DEPLOY-001:PASS
DEPLOY-002:PASS
DEPLOY-003:SKIP
DEPLOY-004:PASS
```

| 编号 | 检查项 |
|------|--------|
| DEPLOY-001 | 制品完整性（archive + manifest 存在） |
| DEPLOY-002 | 依赖解析（lock 文件 + 关键依赖安装） |
| DEPLOY-003 | 数据库初始化（无 dbConfig 则 SKIP） |
| DEPLOY-004 | 配置完整性（.env 变量齐备） |

### report.md

```markdown
# <NN-Project> 部署验证报告

## 概要
- 验证时间: <YYYY-MM-DD HH:mm>
- 部署模式: <local|remote>
- 验证结果: <通过数>/<总数>

## 结果概览
| 编号 | 检查项 | 结果 | 备注 |

## 详细结果
### DEPLOY-NNN: <检查项> - PASS/FAIL/SKIP
**步骤**: ...
**预期**: ...
**实际**: ...
```

## 错误处理原则

| 情况 | 处理 |
|------|------|
| 构建失败 | 终止，报告错误日志 |
| 文档缺失关键字段 | 终止，报告「项目部署文档缺少 xxx」 |
| 远程组件缺失 | 报告缺失清单，等用户处理 |
| 数据库初始化失败 | 终止，报告错误 |
| .env 配置不完整 | 终止，报告缺失变量 |

**统一原则：失败即报告，不猜测、不兜底、不帮项目修问题。**

## 禁止

- 启动服务（validator 负责）
- 健康检查（validator 负责）
- 更新 baseURL（validator 负责）
- 修改 `repository/` 源码
- 删除 `case/`、`.last_hash`、`.pipeline-state.json`
- 猜测构建命令或启动方式
- 反复尝试失败的步骤
