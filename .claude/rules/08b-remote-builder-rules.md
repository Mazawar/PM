# builder 远程部署规则

> 配套 agent: `project-manage-builder`
> 本地构建部分见 `03b-builder-rules.md`

## 触发条件

- `environment.json.build.mode == "remote"`
- `environment.json.remoteConfig.server` 已绑定
- `environment.json.remoteConfig.deployPath` 已设置

## 工具

**仅 SSH MCP 工具**：`ssh_execute`、`ssh_execute_sudo`、`ssh_upload`、`ssh_db_*` 等。禁止用 `Bash` + `ssh`。

## 步骤（在 03b 共用步骤基础上追加）

### 1. 打包 `<NN-Project>.tar.gz`（本地）

```bash
cd test_project/<NN-Project>/build
rm -rf <NN-Project>
cp -a dev <NN-Project>
tar -czf <NN-Project>.tar.gz <NN-Project>/
rm -rf <NN-Project>
```

### 2. 写 deploy-config.json

```json
{
  "project": "<NN-Project>",
  "server": "<server>",
  "serverIP": "<ip>",
  "deployPath": "<deployPath>",
  "os": "<os>",
  "installedComponents": {},
  "ports": { "frontend": 0, "backend": 0, "nginx": 0 },
  "deployTime": "ISO",
  "verifiedSteps": []
}
```

### 3. 写 nginx.conf（如有前端）

```nginx
server {
  listen 80;
  server_name _;
  root <deployPath>/software/apps/web/dist;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }
  location /api/ { proxy_pass http://127.0.0.1:<backendPort>; }
}
```

### 4. 安装系统运行时（远程）

按 `analyzer.remoteProbe.runtime` 决定安装项：
- 缺失 → 安装
- 已存在且版本满足 → 跳过
- 已存在但版本不满足 → 用 nvm 等版本管理工具安装

**不在此步骤安装项目依赖**（`pnpm install` 等在本地 dev/ 中已装好）。

每项安装后验证：`xxx --version` + `systemctl is-active xxx`。

### 5. 上传 dev/ 到远程

```bash
ssh_upload <NN-Project>.tar.gz <deployPath>/
ssh_execute "cd $(dirname <deployPath>) && tar -xzf <deployPath>/<NN-Project>.tar.gz"
```

验证解压：`ls <deployPath>/software/package.json`。

### 6. 操作前备份

**首次部署可跳过**，重绑定/更新部署必做：

```bash
# MySQL 备份
mysqldump | gzip > <deployPath>/backup/pre-deploy-<timestamp>.sql.gz

# Nginx 备份
cp /etc/nginx/sites-available/<NN-Project> <deployPath>/backup/nginx-<timestamp>.conf
```

验证文件大小 > 0 字节，记录路径到 `deploy-config.json` 和 `version-log.json` 当前记录的 `backupPaths`。

### 7. 配置 .env + 初始化数据库

1. 从 `.env.development` 复制为 `.env`
2. 修改 `DATABASE_URL` 指向 `localhost` 或远程 DB
3. 读取 `analyzer.dbConfig.initMethod`：
   - `sql-dump`：建库 → 导入全量 SQL。**大 SQL 文件（≥50MB）先 SET 优化再导入**：

     ```bash
     # 关约束 + 调参（单条 session 级别）
     ssh_execute "mysql -u<user> -p'<password>' <dbname> -e 'SET foreign_key_checks=0; SET unique_checks=0; SET SQL_LOG_BIN=0; SET SESSION bulk_insert_buffer_size=256*1024*1024; SET SESSION innodb_flush_log_at_trx_commit=2; SET SESSION autocommit=0;'"
     # 导入 SQL（标准重定向）
     ssh_execute "mysql -u<user> -p'<password>' --default-character-set=utf8mb4 <dbname> < <deployPath>/database/*.sql"
     # 恢复
     ssh_execute "mysql -u<user> -p'<password>' <dbname> -e 'COMMIT; SET foreign_key_checks=1; SET unique_checks=1; SET SQL_LOG_BIN=1;'"
     ```

   - `prisma-migrate` / `mybatis-sql` 等：执行对应迁移
4. 验证：执行简单查询确认表结构存在
5. 导入 `seedFiles`（如有）

### 8. 写入 build.remote 子段

```json
{
  "build": {
    "remote": {
      "installedComponents": { "node": "v20.10.0", "mysql": "8.0.35", "nginx": "1.24.0" },
      "uploadArchive": "<NN-Project>.tar.gz",
      "uploadedAt": "ISO",
      "backupPaths": ["backup/pre-deploy-<ts>.sql.gz"],
      "deployPath": "/home/user/projects/<NN-Project>"
    }
  }
}
```

## 远程目录结构（强制）

```
<deployPath>/
├── software/      # 含 node_modules
├── database/
├── update_readme.md
├── deploy.md
├── logs/          # 统一日志
└── backup/        # 备份
```

**禁止**在 `$HOME`、`/tmp`、`/opt` 散落项目文件。**禁止** `*.log` 散落到根或 apps/。

## 临时文件管理

部署过程产生的临时文件放本地 `test_project/<NN-Project>/build/tmp/`。

部署成功后清理 `build/tmp/` 内非占位文件，保留 `.gitkeep`。

## 禁止

- 修改 `repository/` 下的源码
- 自动修改 `environment.json.baseURL`（validator 阶段处理）
- 启动后端 / 写 SETUP.md（validator 阶段处理）
- 删除旧服务器上的远程文件（用户可能仍需要）
