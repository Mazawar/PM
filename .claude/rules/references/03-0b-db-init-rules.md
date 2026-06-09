# 03-0b 数据库初始化规则

> 所属：03-analyzer 子规则

## 数据库初始化优先级

1. **完整 SQL dump 优先**（`.sql` 文件，通常几十 MB 到几百 MB）
2. ORM schema 同步 + seed 脚本 — 仅在没有 SQL dump 时使用
3. **禁止** ORM 建空表 + 手动插几条数据就认为完成

SQL dump 导入指定 `--default-character-set=utf8mb4` 防止中文乱码。

### 版本化 SQL 初始化流程

仓库中存在 `version/` 目录且包含版本子目录时，按**版本号升序**逐一执行：

```
初始化顺序：
1. <全量 SQL dump>.sql                       — 初始结构 + 全量数据
2. version/<vX.Y.Z>/sql/migrate_*.sql        — 该版本变更
3. version/<vX.Y.Z>/sql/seed_*.sql            — 该版本种子数据（放在 migrate 之后）
...按版本号升序逐一执行
```

- 全量 SQL dump 必须最先执行
- 版本迁移按目录名排序（`v0.0.1` → `v0.0.2` → ...），不能跳过中间版本
- 每个版本内先执行 `migrate_*.sql`，再执行 `seed_*.sql`（如有）
- analyzer 在 `dbConfig.initFiles` 中如实列出**全部** SQL 文件（全量 dump + 各版本 migrate + seed），按执行顺序排列
- 组装 `build/dev/database/` 时，保持扁平版本目录结构：`database/< vX.Y.Z >/migrate_*.sql`

```json
// dbConfig 按项目实际情况选择 initMethod：

// 1. sql-dump：仅全量 SQL 文件
"dbConfig": {
  "url": "mysql://...",
  "initMethod": "sql-dump",
  "initFiles": ["database/init.sql"],
  "seedFiles": []
}

// 2. sql-scripts：多个 SQL 脚本（无版本目录）
"dbConfig": {
  "url": "mysql://...",
  "initMethod": "sql-scripts",
  "initFiles": ["schema.sql", "data.sql"],
  "seedFiles": ["seed.sql"]
}

// 3. versioned-sql：仓库含 version/ 目录时，按版本升序列出全部 SQL
"dbConfig": {
  "url": "mysql://...",
  "initMethod": "versioned-sql",
  "initFiles": ["<全量dump>.sql", "<版本目录>/migrate_*.sql", "..."],
  "seedFiles": ["<版本目录>/seed_*.sql"]
}
```
