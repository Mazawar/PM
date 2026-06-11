# 03-0e 输出字段模板

> 所属：03-analyzer 子规则

## 写入字段（environment.json.analyzer）

```json
{
  "analyzer": {
    "completedAt": "ISO",
    "techStack": { "frontend": "Vue3+Vite", "backend": "NestJS", "language": "TypeScript" },
    "ports": { "frontend": 5173, "backend": 3000 },
    "middleware": ["MySQL"],
    "credentials": { "username": "admin", "password": "..." },
    "dbConfig": {
      "url": "protocol://user:pass@host:port/db",
      "initMethod": "sql-dump | prisma-migrate | mybatis-sql | jpa-hibernate | flyway | django-migrate | sql-scripts | versioned-sql",
      "initFiles": ["database/init.sql"],
      "seedFiles": ["database/seed.sql"]
    },
    "login": { "url": "/login", "usernamePlaceholder": "...", "passwordPlaceholder": "...", "submitButton": "..." },
    "startCommand": { "frontend": "...", "backend": "...", "full": "..." },
    "healthCheck": { "url": "http://localhost:5173", "method": "GET", "expectedStatus": 200 },
    "deploymentDocs": {
      "deliveryModel": "pre-built | source-build",
      "source": "track/ | repository/",
      "readFiles": ["<部署文档>", "<启动脚本>"],
      "sourceLocations": {
        "buildCommand": "update_readme.md §2 编译包结构说明（pre-built 模式无需编译）",
        "startCommand": "update_readme.md §6 环境变量与配置变更",
        "envVars": ".env.example",
        "dbInit": "update_readme.md §5 数据库变更"
      },
      "buildCommand": "NONE | pnpm install && pnpm build",
      "frontendBuild": {
        "command": "npm run build:prod",
        "workDir": "<前端目录相对路径>",
        "outputDir": "dist/"
      },
      "startCommand": "pm2 start ecosystem.config.cjs",
      "dbInit": "mysql -u root -p --default-character-set=utf8mb4 <db> < database/<dump>.sql",
      "envVars": ["DATABASE_URL", "PORT"],
      "directoryLayout": {
        "backend": { "source": "api/", "targetDir": "backend/" },
        "frontend": { "source": "web/", "targetDir": "frontend/" },
        "database": { "source": "database/", "targetDir": "database/" },
        "config": {
          "method": "env-export | dotenv | application-yml | none",
          "envSource": ".env.example",
          "envTarget": "backend/.env",
          "applyCommand": "cd backend && export $(cat .env | grep -v '^#' | xargs) && nohup java -jar <artifact> > ../logs/backend.log 2>&1 &"
        }
      },
      "knownIssues": ["Prisma 需指定 binaryTargets", "前端需 Nginx 代理"],
      "warnings": []
    },
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
