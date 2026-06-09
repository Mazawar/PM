# 04-0d 部署指南模板规则

> 所属：04-deployer 子规则

## deploy.md（强制，完整部署指南）

`build/dev/deploy.md` 是**独立可用的部署文档**。拿到 `build/dev/` 整个目录的人，只凭这份文档就能从零部署项目，不需要回看源码或 analyzer 输出。

**内容模板**（deployer 从 `environment.json.analyzer` 提取实际值填充）：

```markdown
# <项目名> 部署指南

## 版本信息

| 项目 | 值 |
|------|-----|
| 版本 | <从 version-log.json 最新记录取 version，如 v1.0.0> |
| 构建时间 | <从 version-log.json 最新记录取 builtAt> |
| Git Commit | <从 version-log.json 最新记录取 commit> |
| 部署模式 | <local / remote> |
| 部署路径 | <deployPath，remote 模式时> |

## 1. 环境要求

| 组件 | 版本要求 | 验证命令 |
|------|---------|---------|
| OS | Ubuntu 20.04+ | `lsb_release -a` |
| Java | <从 techStack 取，如 21+> | `java -version` |
| Maven | <如有> | `mvn -version` |
| MySQL | <从 middleware 取，如 8.0+> | `mysql --version` |
| Nginx | <有前端时要求> | `nginx -v` |

磁盘空间：后端产物 <大小>M + 前端 <大小>M + 数据库 <大小>M ≈ <总大小>M

## 2. 环境安装

### Java
```bash
# Ubuntu (Adoptium Temurin)
sudo apt-get update
sudo apt-get install -y wget apt-transport-https
wget -O - https://packages.adoptium.net/artifactory/api/gpg/key/public | sudo apt-key add -
echo "deb https://packages.adoptium.net/artifactory/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/adoptium.list
sudo apt-get update
sudo apt-get install -y temurin-<版本>-jdk
```

### Maven（如需要）
```bash
sudo apt-get install -y maven
```

### MySQL
```bash
sudo apt-get install -y mysql-server
sudo systemctl start mysql
sudo systemctl enable mysql
# 安全初始化（可选）
sudo mysql_secure_installation
```

### Nginx（有前端时）
```bash
sudo apt-get install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

## 3. 数据库初始化

```bash
# 创建数据库
sudo mysql -u root -e "CREATE DATABASE IF NOT EXISTS <数据库名> DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_0900_ai_ci;"

# 导入 SQL（按顺序）
sudo mysql -u root <数据库名> < database/<文件1>.sql
sudo mysql -u root <数据库名> < database/<文件2>.sql
...

# 验证
sudo mysql -u root <数据库名> -e "SHOW TABLES;"
```

预期表数量：<从 dbConfig 推断>

## 4. 部署项目

### 上传文件
将本目录（dev/）上传到服务器：
```bash
scp -r dev/ <user>@<server>:<deployPath>/
```

### 配置环境变量
编辑 `<deployPath>/backend/.env`：
```env
<逐一列出 envVars 及其值/说明>
```

### 目录结构
```
<deployPath>/
├── backend/
│   ├── <主产物文件>（如 xxx.jar）
│   └── .env
├── frontend/        （有前端时）
│   └── index.html
├── database/
│   └── *.sql
└── logs/
```

## 5. Nginx 配置（有前端时）

创建配置文件：
```bash
sudo cp <deployPath>/../nginx.conf /etc/nginx/sites-available/<项目名>
sudo ln -sf /etc/nginx/sites-available/<项目名> /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

nginx.conf 内容见同目录下 `nginx.conf` 文件。

## 6. 启动服务

```bash
cd <deployPath>/backend
nohup java -jar <主产物文件> <启动参数> > <deployPath>/logs/backend.log 2>&1 &
```

验证端口监听：
```bash
ss -tlnp | grep :<backendPort>
```

## 7. 验证

```bash
# 健康检查
curl -s -o /dev/null -w "%{http_code}" http://localhost:<backendPort><healthCheck路径>
# 预期: <expectedStatus>

# 前端页面
curl -s -o /dev/null -w "%{http_code}" http://localhost:<frontendPort>
# 预期: 200

# 登录验证
curl -s -X POST http://localhost:<backendPort>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<用户名>","password":"<密码>"}'
# 预期: 含 token 的 JSON
```

## 8. 运维

### 停止服务
```bash
kill $(ss -tlnp | grep :<backendPort> | grep -oP 'pid=\K[0-9]+')
```

### 重启服务
```bash
# 先停止，再执行「启动服务」步骤
```

### 查看日志
```bash
tail -f <deployPath>/logs/backend.log
```

### 常见问题
| 问题 | 排查 |
|------|------|
| 端口被占用 | `ss -tlnp \| grep :<端口>` 找到占用进程 |
| 数据库连接失败 | 检查 .env 中 MYSQL_* 变量，`systemctl status mysql` |
| Nginx 502 | 后端未启动或端口不对，检查 backend.log |
| 前白屏 | 检查 Nginx 配置中前端静态文件路径是否正确 |

## 9. 升级与回滚（非首次部署）

### 升级前备份

```bash
# 1. 备份数据库
sudo mysqldump -u root <数据库名> > /var/backups/<项目名>/pre-upgrade-$(date +%Y%m%d-%H%M%S).sql

# 2. 备份配置文件
cp <deployPath>/backend/.env /var/backups/<项目名>/backend.env.bak

# 3. 备份列表（最多保留 5 份）
ls -lt /var/backups/<项目名>/
```

### 升级步骤

```bash
# 1. 停止当前服务（见「停止服务」步骤）

# 2. 备份当前产物（可选）
cp -r <deployPath>/backend <deployPath>/backend.bak.<旧版本>

# 3. 替换产物
#    上传新的 dev/ 内容覆盖 <deployPath>/
#    注意保留 .env（不要覆盖）

# 4. 数据库迁移（如有新 SQL）
sudo mysql -u root <数据库名> < database/<新版本迁移文件>.sql

# 5. 启动服务（见「启动服务」步骤）

# 6. 验证（见「验证」步骤）
```

### 回滚

升级失败时，恢复到上一版本：

```bash
# 1. 停止服务

# 2. 恢复数据库
sudo mysql -u root <数据库名> < /var/backups/<项目名>/pre-upgrade-<时间戳>.sql

# 3. 恢复后端产物
rm -rf <deployPath>/backend
cp -r <deployPath>/backend.bak.<旧版本> <deployPath>/backend

# 4. 恢复配置（如被覆盖）
cp /var/backups/<项目名>/backend.env.bak <deployPath>/backend/.env

# 5. 启动服务并验证
```

### 回滚检查清单

- [ ] 数据库备份文件存在且大小合理
- [ ] backend.bak 目录存在且产物完整
- [ ] .env 配置已恢复
- [ ] 服务启动成功，健康检查通过
```

**填充规则**：
- 所有 `<占位符>` 从 `environment.json.analyzer` 对应字段取值
- `<>` 中的内容必须替换为实际值，不允许保留占位符
- 有前端时包含第 5 节（Nginx），无前端时删除
- Maven/Node.js/Python 等运行时按实际 techStack 选择性包含
- MySQL/PostgreSQL/MongoDB 按实际 dbConfig 选择对应命令
- 数据库安装命令需包含 `--default-character-set=utf8mb4`（MySQL）
