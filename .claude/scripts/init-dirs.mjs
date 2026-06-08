#!/usr/bin/env node

/**
 * PM 项目目录初始化脚本
 *
 * 为 test_project/<NN-Project>/ 创建运行时所需的目录结构。
 * 已存在的目录和文件不会被覆盖。
 *
 * 用法:
 *   node .claude/scripts/init-dirs.mjs --project <NN-Project>
 */

import { existsSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'fs';
import { resolve, join } from 'path';

const args = process.argv.slice(2);
const projectIdx = args.indexOf('--project');
const projectName = projectIdx >= 0 ? args[projectIdx + 1] : null;

if (!projectName) {
  console.error('用法: node init-dirs.mjs --project <NN-Project>');
  process.exit(1);
}

const PROJECT_ROOT = resolve(import.meta.dirname, '../..');
const projectDir = join(PROJECT_ROOT, 'test_project', projectName);

if (!existsSync(projectDir)) {
  console.error(`项目目录不存在: ${projectDir}`);
  process.exit(1);
}

// --- 目录定义 ---
// name: 相对于 projectDir 的路径
// guardFile: 保护性说明文件（仅在该文件不存在时写入）
const directories = [
  {
    name: 'case',
    guardFile: 'README.md',
    guardContent: `# 用户案例目录

将业务案例、测试场景、验收标准等文件放入此目录。

- 文件格式不限（.md、.txt 等），结构不限
- planner 在规划阶段会**优先读取**此目录中的内容
- 文件内容将作为测试计划生成的首要输入
`,
  },
  {
    name: 'plans',
    guardFile: null,
  },
  {
    name: 'tests',
    guardFile: null,
  },
  {
    name: 'test-config',
    guardFile: null,
  },
  {
    name: 'results',
    guardFile: null,
  },
  {
    name: 'scan-logs',
    guardFile: null,
  },
  {
    name: 'results/build',
    guardFile: 'README.md',
    guardContent: `# 构建测试报告目录

存放构建验证环节的产物（与业务测试 scan-logs 平级，但路径独立为 \`results/build/\`）。

- **progress.txt** — 8 项构建验证项的 PASS/FAIL/SKIP 状态
- **report.md** — 详细验证结果（制品完整性、依赖、数据库、配置、启动、健康、页面、登录）
- **summary.md** — 跨项目构建验证汇总

构建验证是测试流程的第一道闸门，不通过不进入端到端测试。
`,
  },
  {
    name: 'build/artifacts',
    guardFile: null,
  },
  {
    name: 'templates',
    guardFile: 'generate-report-template.md',
    guardContent: null, // 特殊处理：从全局模板复制
  },
];

// --- 执行 ---
let created = 0;
let skipped = 0;

for (const dir of directories) {
  const dirPath = join(projectDir, dir.name);

  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
    console.log(`  ✓ 创建 ${dir.name}/`);
    created++;
  } else {
    console.log(`  · 已存在 ${dir.name}/`);
    skipped++;
  }

  if (dir.guardFile) {
    const guardPath = join(dirPath, dir.guardFile);
    if (!existsSync(guardPath)) {
      if (dir.guardContent) {
        writeFileSync(guardPath, dir.guardContent, 'utf-8');
        console.log(`  ✓ 写入 ${dir.name}/${dir.guardFile}`);
      } else {
        // guardContent 为 null 时从全局模板复制
        const globalTemplate = join(PROJECT_ROOT, '.claude', 'templates', dir.guardFile);
        if (existsSync(globalTemplate)) {
          copyFileSync(globalTemplate, guardPath);
          console.log(`  ✓ 复制全局模板 -> ${dir.name}/${dir.guardFile}`);
        } else {
          // 全局模板也不存在 → 写空文件占位
          writeFileSync(guardPath, '', 'utf-8');
          console.log(`  · ${dir.name}/${dir.guardFile}（全局模板不存在，创建空文件）`);
        }
      }
    } else {
      console.log(`  · 已存在 ${dir.name}/${dir.guardFile}，跳过`);
    }
  }
}

console.log(`\n完成: ${created} 个目录创建, ${skipped} 个已存在`);
