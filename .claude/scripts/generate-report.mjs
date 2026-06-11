#!/usr/bin/env node

/**
 * PM Playwright 报告自动生成脚本
 *
 * 从 Playwright JSON 报告解析测试结果，自动生成：
 *   - results/{module}/progress.txt   TC 进度追踪
 *   - results/{module}/report.md      模块详细报告
 *   - results/summary.md              汇总报告
 *
 * 用法:
 *   # 先用 JSON reporter 运行测试：
 *   npx playwright test --config=test_project/<NN>/playwright.config.ts --reporter=json,line
 *   # 然后生成报告：
 *   node .claude/scripts/generate-report.mjs --project <NN-Project>
 *   # 指定 JSON 报告路径：
 *   node .claude/scripts/generate-report.mjs --project <NN-Project> --report path/to/report.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'fs';
import { resolve, join, dirname, basename } from 'path';
import { toLocalStr } from './lib/time.mjs';

// --- 参数解析 ---
const args = process.argv.slice(2);
const projectArg = args.find(a => !a.startsWith('--'));
const reportIdx = args.indexOf('--report');
const reportPath = reportIdx >= 0 ? args[reportIdx + 1] : null;

const PROJECT_ROOT = resolve(import.meta.dirname, '../..');

if (!projectArg) {
  console.error('用法: node generate-report.mjs --project <NN-Project> [--report path/to/report.json]');
  process.exit(1);
}

const projectDir = join(PROJECT_ROOT, 'test_project', projectArg);
if (!existsSync(projectDir)) {
  console.error(`项目目录不存在: ${projectDir}`);
  process.exit(1);
}

const resultsDir = join(projectDir, 'results');

// --- 加载模板（项目级 → 全局 fallback）---
function loadReportTemplate() {
  const candidates = [
    join(projectDir, 'templates', 'generate-report-template.md'),
    join(PROJECT_ROOT, '.claude', 'templates', 'generate-report-template.md'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, 'utf-8');
  }
  console.error('未找到模板文件');
  process.exit(1);
}

const REPORT_TEMPLATE = loadReportTemplate();

// --- 渲染重复块 {{#key}}...{{/key}} ---
// 模板中用 {{#rows}} 和 {{/rows}} 包裹行模板，脚本按 TC 数量展开
function renderRepeatBlock(template, key, items, getVars) {
  const startTag = `{{#${key}}}`;
  const endTag = `{{/${key}}}`;
  const startIdx = template.indexOf(startTag);
  const endIdx = template.indexOf(endTag);
  if (startIdx === -1 || endIdx === -1) return template;

  const blockTpl = template.slice(startIdx + startTag.length, endIdx);
  const rendered = items.map((item, i) => {
    const vars = getVars(item, i);
    let row = blockTpl;
    for (const [k, v] of Object.entries(vars)) {
      row = row.replaceAll(`{{${k}}}`, v);
    }
    return row;
  }).join('');

  return template.slice(0, startIdx) + rendered + template.slice(endIdx + endTag.length);
}

// --- 定位 JSON 报告 ---
function findReport() {
  if (reportPath && existsSync(reportPath)) return reportPath;

  // 默认位置：Playwright 输出到项目目录下的 playwright-report.json
  const candidates = [
    join(projectDir, 'playwright-report.json'),
    join(PROJECT_ROOT, 'playwright-report.json'),
    join(projectDir, 'test-results', 'report.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

const jsonPath = findReport();
if (!jsonPath) {
  console.error('未找到 Playwright JSON 报告。请先运行测试：');
  console.error('  npx playwright test --config=test_project/' + projectArg + '/playwright.config.ts --reporter=json,line');
  console.error('或指定报告路径：--report path/to/report.json');
  process.exit(1);
}

console.log(`读取报告: ${jsonPath}`);

// --- 解析 Playwright JSON 报告 ---
const report = JSON.parse(readFileSync(jsonPath, 'utf-8'));

/**
 * 从测试文件内容提取 MODULE 和 TC 信息
 */
function parseFileHeader(filePath) {
  const absPath = join(projectDir, 'tests', filePath);
  if (!existsSync(absPath)) return { module: null, tcIds: [] };

  const content = readFileSync(absPath, 'utf-8');
  const moduleMatch = content.match(/\/\/\s*MODULE:\s*(.+)/);
  const tcMatch = content.match(/\/\/\s*TC:\s*(.+)/);
  return {
    module: moduleMatch?.[1]?.trim() || null,
    tcIds: tcMatch?.[1]?.trim().split(/[\s,]+/) || [],
  };
}

/**
 * 从文件路径推断模块名
 * tests/e2e/module-name/tc-xxx.spec.ts -> module-name
 */
function moduleFromPath(filePath) {
  const parts = filePath.replace(/\\/g, '/').split('/');
  const testsIdx = parts.findIndex(p => p === 'tests');
  if (testsIdx >= 0 && testsIdx + 2 < parts.length) {
    return parts[testsIdx + 2];
  }
  // path relative to tests/: e2e/auth/tc-001.spec.ts -> auth
  if (parts.length >= 3 && /^(e2e|api)$/.test(parts[0])) {
    return parts[1];
  }
  return null;
}

/**
 * 读取已有 progress.txt，返回 Map<TC-ID, status>
 */
function readExistingProgressMap(modDir) {
  const progPath = join(modDir, 'progress.txt');
  if (!existsSync(progPath)) return new Map();
  const content = readFileSync(progPath, 'utf-8').trim();
  const map = new Map();
  for (const line of content.split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const tcId = line.substring(0, idx).trim();
    const status = line.substring(idx + 1).trim();
    if (tcId && status) map.set(tcId, status);
  }
  return map;
}

/**
 * 读取已有 report.md，提取每个 TC 的详细结果段落和标题
 * 返回 Map<TC-ID, { title, section }>
 */
function readExistingTcData(modDir) {
  const reportPath = join(modDir, 'report.md');
  if (!existsSync(reportPath)) return new Map();
  const content = readFileSync(reportPath, 'utf-8');
  const map = new Map();
  const regex = /### (TC-\d+:[\s\S]*?)(?=### TC-|## 缺陷|## 环境|## 修复|$)/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    const headerLine = m[1].split('\n')[0]; // "TC-XXX: title - PASS"（无 ### 前缀）
    const tcId = headerLine.match(/(TC-\d+)/)?.[1];
    const titleMatch = headerLine.match(/^TC-\d+:\s*(.+?)\s*-\s*(PASS|FAIL|SKIP)$/);
    const title = titleMatch ? titleMatch[1] : tcId;
    const section = m[0].trimEnd();
    const screenshots = [...section.matchAll(/!\[\]\((screenshots\/[^)]+)\)/g)].map(sm => sm[1]);
    if (tcId) map.set(tcId, { title, section, screenshots });
  }
  return map;
}

/**
 * 从测试标题提取 TC 编号
 * "TC-001: 登录测试" -> TC-001
 */
function tcIdFromTitle(title) {
  const match = title.match(/(TC-\d+)/);
  return match?.[1] || null;
}

// --- 收集所有测试结果 ---
const testResults = [];

function collectTests(specs, parentFile) {
  for (const spec of specs || []) {
    const filePath = spec.file || parentFile;
    const header = filePath ? parseFileHeader(filePath) : { module: null, tcIds: [] };
    const module = header.module || moduleFromPath(filePath) || 'unknown';
    const tcId = tcIdFromTitle(spec.title) || header.tcIds[0] || 'TC-???';

    // 取最后一次运行的结果
    const lastRun = spec.tests?.[spec.tests.length - 1];
    const lastResult = lastRun?.results?.[lastRun.results.length - 1];

    const status = lastResult?.status || 'skipped';
    const duration = lastResult?.duration || 0;
    const error = lastResult?.error;
    const steps = lastResult?.steps || [];

    // 提取截图附件
    const screenshots = (lastResult?.attachments || [])
      .filter(a => a.contentType?.startsWith('image/') || a.path?.endsWith('.png'))
      .map(a => a.path ? a.path : null)
      .filter(Boolean);

    testResults.push({
      tcId,
      title: spec.title.replace(/^(TC-\d+:\s*)/, ''),
      module,
      filePath,
      status: status === 'timedOut' ? 'failed' : status,
      rawStatus: status,
      duration,
      error: error ? {
        message: error.message?.split('\n')[0] || '',
        stack: error.stack || '',
      } : null,
      steps,
      screenshots,
    });
  }
}

function walkSuites(suites, parentFile) {
  for (const suite of suites || []) {
    const file = suite.file || parentFile;
    collectTests(suite.specs || [], file);
    walkSuites(suite.suites || [], file);
  }
}

walkSuites(report.suites);

// 排除种子文件
const filtered = testResults.filter(t => !t.title.includes('seed') && !t.filePath?.includes('seed.spec'));

if (filtered.length === 0) {
  console.log('未找到测试结果（已排除 seed 文件）');
  process.exit(0);
}

console.log(`解析到 ${filtered.length} 条测试结果`);

// --- 按模块分组 ---
const modules = {};
for (const t of filtered) {
  if (!modules[t.module]) modules[t.module] = [];
  modules[t.module].push(t);
}

// --- 生成 progress.txt ---
function generateProgress(module, tests) {
  const lines = tests.map(t => {
    const status = t.status === 'passed' ? 'PASS' : t.status === 'skipped' ? 'SKIP' : 'FAIL';
    return `${t.tcId}:${status}`;
  });
  return lines.join('\n') + '\n';
}

// --- 渲染 report.md（模板驱动）---
function generateReport(module, tests, env) {
  const now = new Date();
  const timeStr = toLocalStr(now);
  const passCount = tests.filter(t => t.status === 'passed').length;
  const failCount = tests.filter(t => t.status === 'failed').length;
  const skipCount = tests.filter(t => t.status === 'skipped').length;
  const rate = tests.length > 0 ? Math.round(passCount / tests.length * 100) : 0;

  // 结果概览表（由模板 {{#rows}}{{/rows}} 控制列结构）
  let md = REPORT_TEMPLATE;
  md = renderRepeatBlock(md, 'rows', tests, (t, i) => {
    const status = t.status === 'passed' ? 'PASS' : t.status === 'skipped' ? 'SKIP' : 'FAIL';
    const shot = t.screenshots.length > 0 ? `![](${t.screenshots[t.screenshots.length - 1]})` : '-';
    return {
      index: String(i + 1),
      tcId: t.tcId,
      name: t.title,
      status,
      shot,
    };
  });

  // 生成详细结果
  const details = tests.map(t => {
    if (t._existingSection) return t._existingSection;

    const status = t.status === 'passed' ? 'PASS' : t.status === 'skipped' ? 'SKIP' : 'FAIL';
    let md = `### ${t.tcId}: ${t.title} - ${status}\n`;

    if (t.steps.length > 0) {
      md += `**步骤**:\n`;
      for (const step of t.steps) {
        if (step.title) md += `1. ${step.title} - ${step.error ? 'FAIL' : 'OK'}\n`;
      }
      md += '\n';
    }

    if (t.error) {
      md += `**预期**: （根据测试计划）\n`;
      md += `**实际**: ${t.error.message}\n\n`;
    }

    if (t.screenshots.length > 0) {
      md += `**截图**:\n`;
      for (const s of t.screenshots) md += `![](${s})\n\n`;
    }

    return md;
  }).join('\n');

  // 生成缺陷汇总
  const failed = tests.filter(t => t.status === 'failed');
  let defectSummary = '';
  if (failed.length > 0) {
    defectSummary = `## 缺陷汇总\n`;
    defectSummary += `| # | 严重程度 | 用例 | 描述 | 建议 |\n`;
    defectSummary += `|---|---------|------|------|------|\n`;
    failed.forEach((t, i) => {
      defectSummary += `| ${i + 1} | P1 | ${t.tcId} | ${t.error?.message || '未知错误'} | 需排查修复 |\n`;
    });
    defectSummary += '\n';
  }

  // 替换模板变量（{{#rows}}{{/rows}} 已在上面展开）
  const baseURL = env.validator?.remote?.baseURL || env.analyzer?.baseURL || env.baseURL || '-';
  return md
    .replace(/\{\{module\}\}/g, module)
    .replace(/\{\{baseURL\}\}/g, baseURL)
    .replace(/\{\{testTime\}\}/g, timeStr)
    .replace(/\{\{passCount\}\}/g, passCount)
    .replace(/\{\{failCount\}\}/g, failCount)
    .replace(/\{\{skipCount\}\}/g, skipCount)
    .replace(/\{\{totalCount\}\}/g, tests.length)
    .replace(/\{\{passRate\}\}/g, rate)
    .replace(/\{\{tcDetails\}\}/g, details)
    .replace(/\{\{defectSummary\}\}/g, defectSummary);
}

// --- 生成 summary.md ---
function generateSummary(modules, allTests, env) {
  const now = new Date();
  const timeStr = toLocalStr(now);
  const totalPass = allTests.filter(t => t.status === 'passed').length;
  const totalFail = allTests.filter(t => t.status === 'failed').length;
  const totalSkip = allTests.filter(t => t.status === 'skipped').length;
  const total = allTests.length;
  const rate = total > 0 ? Math.round(totalPass / total * 100) : 0;

  let md = `# 测试汇总\n\n`;
  md += `- 项目: ${projectArg}\n`;
  md += `- 更新时间: ${timeStr}\n`;
  md += `- 总通过率: ${totalPass}/${total}（${rate}%）\n\n`;

  md += `## 模块概览\n`;
  md += `| 模块 | 通过 | 失败 | 跳过 | 通过率 |\n`;
  md += `|------|------|------|------|--------|\n`;

  for (const [mod, tests] of Object.entries(modules)) {
    const p = tests.filter(t => t.status === 'passed').length;
    const f = tests.filter(t => t.status === 'failed').length;
    const s = tests.filter(t => t.status === 'skipped').length;
    const r = tests.length > 0 ? Math.round(p / tests.length * 100) : 0;
    md += `| ${mod} | ${p} | ${f} | ${s} | ${r}% |\n`;
  }

  return md;
}

// --- 加载环境配置 ---
const envPath = join(projectDir, 'test-config', 'environment.json');
const env = existsSync(envPath) ? JSON.parse(readFileSync(envPath, 'utf-8')) : {};

// --- 写入文件 ---
mkdirSync(resultsDir, { recursive: true });

for (const [mod, tests] of Object.entries(modules)) {
  const modDir = join(resultsDir, mod);
  mkdirSync(modDir, { recursive: true });
  mkdirSync(join(modDir, 'screenshots'), { recursive: true });

  // resolve screenshots: copy artifacts screenshots to screenshots/, resolve test screenshots as relative
  for (const t of tests) {
    const resolved = [];
    for (const shot of t.screenshots) {
      if (!shot) continue;
      const shotAbs = resolve(shot);
      // already in module screenshots dir
      if (shotAbs.startsWith(resolve(join(modDir, 'screenshots')))) {
        resolved.push(`screenshots/${basename(shotAbs)}`);
      } else if (shotAbs.includes('artifacts')) {
        // copy from artifacts to screenshots with TC-based name
        const ext = shotAbs.endsWith('.png') ? '.png' : '.jpg';
        const newName = `${t.tcId.toLowerCase()}-${basename(shotAbs)}`;
        const dest = join(modDir, 'screenshots', newName);
        if (existsSync(shotAbs)) {
          copyFileSync(shotAbs, dest);
          resolved.push(`screenshots/${newName}`);
        }
      } else if (existsSync(shotAbs)) {
        resolved.push(`screenshots/${basename(shotAbs)}`);
      }
    }
    t.screenshots = resolved;
  }

  // scan screenshots/ directory for historical screenshots matching TC IDs
  const screenshotsDir = join(modDir, 'screenshots');
  if (existsSync(screenshotsDir)) {
    const allScreenshots = readdirSync(screenshotsDir).filter(f => /\.(png|jpg|jpeg)$/i.test(f));
    const tcIdPattern = /^[tT][cC]-?(\d+)/;
    const tcScreenshotMap = new Map();
    for (const f of allScreenshots) {
      const match = f.match(tcIdPattern);
      if (match) {
        const num = match[1];
        const key = `TC-${num.padStart(3, '0')}`;
        if (!tcScreenshotMap.has(key)) tcScreenshotMap.set(key, []);
        tcScreenshotMap.get(key).push(`screenshots/${f}`);
      }
    }
    // merge historical screenshots: add any not already present from Playwright attachments
    for (const t of tests) {
      if (tcScreenshotMap.has(t.tcId)) {
        const existing = new Set(t.screenshots.map(s => basename(s)));
        for (const shot of tcScreenshotMap.get(t.tcId)) {
          if (!existing.has(basename(shot))) {
            t.screenshots.push(shot);
          }
        }
      }
    }
  }

  // --- 合并已有结果：JSON 覆盖/追加，已有 TC 保留 ---
  const existingProgress = readExistingProgressMap(modDir);
  const existingTcData = readExistingTcData(modDir);
  const newTcIds = new Set(tests.map(t => t.tcId));

  // 构建陈旧 TC（已有但本次 JSON 中没有的）
  const staleTests = [];
  for (const [tcId, status] of existingProgress) {
    if (!newTcIds.has(tcId)) {
      const data = existingTcData.get(tcId);
      staleTests.push({
        tcId,
        title: data?.title || tcId,
        status: status === 'PASS' ? 'passed' : status === 'SKIP' ? 'skipped' : 'failed',
        duration: 0,
        error: null,
        steps: [],
        screenshots: data?.screenshots || [],
        _existingSection: data?.section || null,
      });
    }
  }

  // 合并并按 TC 编号排序
  const mergedTests = [...staleTests, ...tests].sort((a, b) => {
    const na = parseInt(a.tcId.match(/\d+/)?.[0] || '0');
    const nb = parseInt(b.tcId.match(/\d+/)?.[0] || '0');
    return na - nb;
  });

  writeFileSync(join(modDir, 'progress.txt'), generateProgress(mod, mergedTests));
  writeFileSync(join(modDir, 'report.md'), generateReport(mod, mergedTests, env));
  const staleInfo = staleTests.length > 0 ? ` (+${staleTests.length} 保留)` : '';
  console.log(`  ✓ ${mod}/progress.txt + report.md (${mergedTests.length} TC${staleInfo})`);
}

writeFileSync(join(resultsDir, 'summary.md'), generateSummary(modules, filtered, env));
console.log(`  ✓ summary.md`);

// --- 合并构建验证结果（deploy + env 分离）---
// deployer 写入 results/.build/deploy/progress.txt
// validator 写入 results/.build/env/progress.txt
const buildSubDirs = ['deploy', 'env'];
const buildTests = [];
for (const sub of buildSubDirs) {
  const progressPath = join(resultsDir, '.build', sub, 'progress.txt');
  if (existsSync(progressPath)) {
    const content = readFileSync(progressPath, 'utf-8').trim();
    const tests = content.split('\n').filter(l => l.includes(':')).map(l => {
      const [tcId, status] = l.split(':').map(s => s.trim());
      return {
        tcId,
        title: tcId,
        module: `.build/${sub}`,
        status: status === 'PASS' ? 'passed' : status === 'SKIP' ? 'skipped' : 'failed',
      };
    });
    if (tests.length > 0) {
      modules[`.build/${sub}`] = tests;
      buildTests.push(...tests);
    }
  }
}
// 兼容旧格式：results/.build/progress.txt 或 results/build/progress.txt
if (buildTests.length === 0) {
  for (const legacyDir of ['.build', 'build']) {
    const legacyPath = join(resultsDir, legacyDir, 'progress.txt');
    if (existsSync(legacyPath)) {
      const content = readFileSync(legacyPath, 'utf-8').trim();
      const tests = content.split('\n').filter(l => l.includes(':')).map(l => {
        const [tcId, status] = l.split(':').map(s => s.trim());
        return {
          tcId,
          title: tcId,
          module: legacyDir,
          status: status === 'PASS' ? 'passed' : status === 'SKIP' ? 'skipped' : 'failed',
        };
      });
      if (tests.length > 0) {
        modules[legacyDir] = tests;
        buildTests.push(...tests);
      }
      break;
    }
  }
}
if (buildTests.length > 0) {
  const buildSummaryMd = generateSummary(modules, [...filtered, ...buildTests], env);
  writeFileSync(join(resultsDir, 'summary.md'), buildSummaryMd);
  console.log(`  ✓ summary.md（含构建测试: ${buildTests.length} 项）`);
}

// --- 统计输出 ---
const totalPass = filtered.filter(t => t.status === 'passed').length;
const totalFail = filtered.filter(t => t.status === 'failed').length;
const totalSkip = filtered.filter(t => t.status === 'skipped').length;
const rate = filtered.length > 0 ? Math.round(totalPass / filtered.length * 100) : 0;

console.log(`\n结果: ${totalPass}/${filtered.length} 通过 (${rate}%) | 失败: ${totalFail} | 跳过: ${totalSkip}`);
if (totalFail > 0) {
  console.log(`\n失败用例:`);
  filtered.filter(t => t.status === 'failed').forEach(t => {
    console.log(`  - ${t.tcId}: ${t.title} — ${t.error?.message || '未知'}`);
  });
}
