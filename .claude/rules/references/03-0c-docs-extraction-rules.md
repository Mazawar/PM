# 03-0c 文档提取与目录布局规则

> 所属：03-analyzer 子规则

## track/ 文档提取（强制）

`track/` 目录通过软链接映射了仓库中的关键目录（如 `version/`、`docs/`）。analyzer **必须**读取这些目录中的部署文档和脚本，提取部署知识写入 `deploymentDocs` 段，供 deployer 直接使用而非猜测。

### 读取步骤

1. 检查 `test_project/<NN-Project>/track/` 是否存在
2. 遍历软链接指向的目录，识别并读取以下类型的文件：
   - **部署文档**：`update_readme.md`、`deploy.md`、`DEPLOY.md`、`INSTALL.md`
   - **启动脚本**：`*.sh`（特别是 `start*.sh`、`deploy*.sh`）
   - **配置说明**：`.env.example`、`README.md` 中与部署相关的章节
   - **版本变更**：`version/*/` 下的变更日志、迁移说明
3. 从文档中提取关键信息写入 `deploymentDocs` 段

### 提取内容

| 信息 | 来源 | 用途 |
|------|------|------|
| 构建命令 | 文档中的「构建」/「编译」章节 | deployer 执行编译 |
| 启动命令 | 文档中的「启动」/「运行」章节 | environment.json.startCommand |
| 数据库初始化 | 文档中的「数据库」/「初始化」章节 | SQL 执行顺序 |
| 环境变量 | `.env.example` + 文档说明 | 配置 .env |
| 依赖安装 | 文档中的「依赖」/「安装」章节 | 包管理器、特殊依赖 |
| 目录结构 | 文档中的「目录说明」章节 | 组装 dev/ 的布局依据 |
| 已知问题 | 文档中的「已知问题」/「限制」章节 | 部署避坑 |

### 提取纪律（强制）

**核心原则：从文档原文提取，不从代码推断。**

1. **`buildCommand` 禁止从 `package.json` scripts 推断**。必须在部署文档中找到原文说明（可以是编译命令，也可以是「使用预构建包」的说明）。文档无此说明 → `buildCommand` 写 `"未在文档中找到"`
2. **预构建包识别**：部署文档中明确说「使用预构建包」「解压即可运行」或描述 tar.gz 含编译产物 + node_modules → `deliveryModel: "pre-built"`，`buildCommand: "NONE"`
3. **源码编译识别**：部署文档中给出编译命令（如 `pnpm install && pnpm build`、`mvn package`）→ `deliveryModel: "source-build"`，`buildCommand` 为文档中的原文命令
4. **两种模式都合法**：项目可以提供预构建包，也可以只提供源码和构建说明。关键是**文档必须说明怎么构建或怎么部署**
4. **每个字段附原文出处**：`readFiles` 记录提取了哪些文件，`sourceLocations` 记录每个关键字段来自哪个文件的哪个章节标题
5. **文档中没有的信息 → 写 `"未在文档中找到"`**，禁止自行推断、猜测、从代码反向工程

### 前后端分离构建识别（强制）

**前后端分离项目（前端和后端在不同目录、用不同工具构建）必须分别提取构建信息。**

判断标准：仓库中存在独立的前端目录（且有独立的构建配置如 `package.json` + `vue.config.js`/`vite.config.*`/`webpack.config.*`）→ 前后端分离项目。

提取要求：

| 字段 | 说明 | 缺失时 |
|------|------|--------|
| `frontendBuild.command` | 前端构建命令（如 `npm run build:prod`） | 从前端目录的 `package.json` scripts 中 `build` 字段获取 |
| `frontendBuild.workDir` | 前端构建的工作目录（相对于仓库根目录） | 必须填写 |
| `frontendBuild.outputDir` | 构建产物输出目录（相对于 workDir） | 从构建工具配置推断（`vue.config.js` 的 `outputDir`、`vite.config.*` 的 `build.outDir`，默认 `dist`） |

**单构建项目**（如 NestJS 全栈、Django + 模板）不需要 `frontendBuild`，保持原有 `buildCommand` 即可。

**前后端分离项目的 `buildCommand` 仍指后端构建命令**（如 `mvn clean package`），前端构建由 `frontendBuild` 单独描述。deployer 会分别执行两个构建。

**前端服务策略**：前后端分离项目中，前端**一律通过 Nginx 托管静态文件**。除非项目文档明确要求前端以 dev 模式运行，否则不在远程安装 Node.js、不运行前端 dev server。`frontendBuild.command` 必须是生产构建命令（如 `npm run build:prod`），不是 dev 命令。

### 目录布局映射（强制）

analyzer **必须**将仓库中的产物路径映射到扁平化的 `build/dev/` 结构。`directoryLayout` 是结构化 JSON 对象，deployer 直接使用，禁止自由文本。

#### Schema

```json
{
  "directoryLayout": {
    "backend": {
      "source": "仓库中后端产物的相对路径",
      "artifact": "主产物文件名（可选，目录模式可省略）",
      "targetDir": "backend/"
    },
    "frontend": {
      "source": "仓库中前端构建产物的相对路径",
      "targetDir": "frontend/"
    },
    "database": {
      "source": "仓库中 SQL 文件的相对路径",
      "targetDir": "database/"
    },
    "config": {
      "envSource": "环境模板文件路径",
      "envTarget": "backend/.env"
    }
  }
}
```

#### 字段规则

| 字段 | 必需 | 说明 |
|------|------|------|
| `backend` | 是 | `source` 指向编译产物所在目录（如 `target/`、`dist/`、`build/`），`targetDir` 固定 `"backend/"` |
| `frontend` | 条件 | 有 `frontendBuild` 时必须，`source` 等于 `frontendBuild.workDir` + `frontendBuild.outputDir` |
| `database` | 条件 | 有 `dbConfig` 时必须，`source` 指向 SQL 文件所在目录 |
| `config` | 否 | `envTarget` 固定 `"backend/.env"` |

#### 按项目类型示例

**前后端分离（source-build — Java+Vue）**：
```json
{
  "backend": { "source": "<后端模块>/target/", "artifact": "<产物>.jar", "targetDir": "backend/" },
  "frontend": { "source": "<前端目录>/dist/", "targetDir": "frontend/" },
  "database": { "source": "sql/", "targetDir": "database/" },
  "config": { "envSource": "<前端目录>/.env.development", "envTarget": "backend/.env" }
}
```

**前后端分离（pre-built 包）**：
```json
{
  "backend": { "source": "api/", "targetDir": "backend/" },
  "frontend": { "source": "web/", "targetDir": "frontend/" },
  "database": { "source": "database/", "targetDir": "database/" },
  "config": { "envSource": ".env.example", "envTarget": "backend/.env" }
}
```

**单构建（NestJS 全栈）**：无 `frontend` 字段。
```json
{
  "backend": { "source": "dist/", "targetDir": "backend/" },
  "database": { "source": "prisma/migrations/", "targetDir": "database/" },
  "config": { "envSource": ".env.example", "envTarget": "backend/.env" }
}
```

**一致性校验**：analyzer 写入前必须验证 `frontend.source` 与 `frontendBuild.workDir` + `frontendBuild.outputDir` 一致。

### 如果 track/ 不存在

跳过本步骤，不阻塞 analyzer 完成。deployer 将退回通用推断模式。
