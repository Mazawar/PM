#!/usr/bin/env node

/**
 * PM 测试报告邮件通知脚本
 *
 * 用法:
 *   node .claude/scripts/notify.mjs --project 02-oa-llm           # 发送邮件
 *   node .claude/scripts/notify.mjs --project 02-oa-llm --dry-run # 仅输出邮件内容不发送
 */

import nodemailer from 'nodemailer';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join, basename } from 'path';
import { toLocalStr } from './lib/time.mjs';

// --- 参数解析 ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const projectArg = args.find(a => !a.startsWith('--'));
const PROJECT_ROOT = resolve(import.meta.dirname, '../..');

if (!projectArg) {
  console.error('用法: node notify.mjs --project <NN-Project> [--dry-run]');
  process.exit(1);
}

const projectDir = join(PROJECT_ROOT, 'test_project', projectArg);
if (!existsSync(projectDir)) {
  console.error(`项目目录不存在: ${projectDir}`);
  process.exit(1);
}

// --- 加载配置 ---
const configPath = join(import.meta.dirname, '..', 'notify-config.json');
if (!existsSync(configPath)) {
  console.error(`通知配置不存在: ${configPath}`);
  console.error('请复制 notify-config.example.json 为 notify-config.json 并填写 SMTP 信息');
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, 'utf-8'));

// --- 加载项目环境 ---
const envPath = join(projectDir, 'test-config', 'environment.json');
const env = existsSync(envPath) ? JSON.parse(readFileSync(envPath, 'utf-8')) : {};

// --- 解析 summary.md ---
function parseSummary(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const projectMatch = content.match(/- 项目:\s*(.+)/);
  const timeMatch = content.match(/- 更新时间:\s*(.+)/);
  const rateMatch = content.match(/- 总通过率:\s*(\d+)\/(\d+)（(\d+)%）/);

  const modules = [];
  const lines = content.split('\n');
  let inTable = false;
  for (const line of lines) {
    if (line.includes('| 模块 |')) { inTable = true; continue; }
    if (inTable && line.includes('|---')) continue;
    if (inTable && line.startsWith('|')) {
      const cols = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length >= 5) {
        modules.push({
          name: cols[0],
          pass: parseInt(cols[1]) || 0,
          fail: parseInt(cols[2]) || 0,
          skip: parseInt(cols[3]) || 0,
          rate: cols[4],
        });
      }
    } else if (inTable) {
      inTable = false;
    }
  }

  return {
    project: projectMatch?.[1]?.trim() || projectArg,
    time: timeMatch?.[1]?.trim() || toLocalStr(),
    totalPass: rateMatch ? parseInt(rateMatch[1]) : 0,
    total: rateMatch ? parseInt(rateMatch[2]) : 0,
    rate: rateMatch ? parseInt(rateMatch[3]) : 0,
    modules,
  };
}

// --- 解析 report.md ---
function parseReport(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const moduleName = content.match(/^# (.+) 测试报告/)?.[1] || basename(resolve(filePath, '..'));
  const resultMatch = content.match(/- 执行结果:\s*(\d+)\/(\d+)\s*通过（通过率\s*(\d+)%）/);

  // 解析 TC 结果表格
  const tcResults = [];
  const lines = content.split('\n');
  let inResultTable = false;
  for (const line of lines) {
    if (line.includes('| # |') && line.includes('用例编号')) { inResultTable = true; continue; }
    if (inResultTable && line.includes('|---')) continue;
    if (inResultTable && line.startsWith('|')) {
      const cols = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length >= 4) {
        tcResults.push({
          tcId: cols[1],
          name: cols[2],
          result: cols[3],
        });
      }
    } else if (inResultTable) {
      inResultTable = false;
    }
  }

  // 解析缺陷汇总
  const defects = [];
  let inDefectTable = false;
  for (const line of lines) {
    if (line.includes('| # |') && line.includes('严重程度')) { inDefectTable = true; continue; }
    if (inDefectTable && line.includes('|---')) continue;
    if (inDefectTable && line.startsWith('|')) {
      const cols = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length >= 4) {
        defects.push({
          severity: cols[1],
          tc: cols[2],
          desc: cols[3],
          suggestion: cols[4] || '',
        });
      }
    } else if (inDefectTable) {
      inDefectTable = false;
    }
  }

  return {
    module: moduleName,
    pass: resultMatch ? parseInt(resultMatch[1]) : 0,
    total: resultMatch ? parseInt(resultMatch[2]) : 0,
    rate: resultMatch ? parseInt(resultMatch[3]) : 0,
    tcResults,
    defects,
  };
}

// --- 打包报告目录为 zip 附件 ---
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const archiver = require('archiver');
import { createWriteStream } from 'fs';
import { tmpdir } from 'os';

function packReportZip(projectDir, projectName) {
  const resultsDir = join(projectDir, 'results');
  if (!existsSync(resultsDir)) return null;

  const zipPath = join(tmpdir(), `${projectName}-test-report-${Date.now()}.zip`);

  return new Promise((resolve) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => {
      if (existsSync(zipPath)) {
        resolve({ filename: `${projectName}-test-report.zip`, path: zipPath });
      } else {
        resolve(null);
      }
    });

    archive.on('error', (err) => {
      console.error('打包报告失败:', err.message);
      resolve(null);
    });

    archive.pipe(output);
    archive.directory(resultsDir, `${projectName}-results`, (entry) => {
      // 排除 artifacts 目录（Playwright trace 文件，体积大且对报告无用）
      if (entry.name.includes('/artifacts/') || entry.name.startsWith('artifacts/')) return false;
      return entry;
    });
    archive.finalize();
  });
}

// --- 渲染 HTML 邮件 ---
function renderEmail(summary, reports, attachments) {
  const failedCount = summary.total - summary.totalPass;
  const statusEmoji = failedCount > 0 ? '🔴' : '✅';
  const statusText = failedCount > 0 ? `${failedCount} 个失败` : '全部通过';

  // 模块概览表格行
  const moduleRows = summary.modules.map(m => {
    const status = m.fail > 0
      ? `<span style="color:#e74c3c">${m.rate}</span>`
      : `<span style="color:#27ae60">${m.rate}</span>`;
    return `<tr>
      <td style="padding:8px 12px;border:1px solid #ddd;">${m.name}</td>
      <td style="padding:8px 12px;border:1px solid #ddd;text-align:center;color:#27ae60;">${m.pass}</td>
      <td style="padding:8px 12px;border:1px solid #ddd;text-align:center;${m.fail > 0 ? 'color:#e74c3c;' : ''}">${m.fail}</td>
      <td style="padding:8px 12px;border:1px solid #ddd;text-align:center;">${m.skip}</td>
      <td style="padding:8px 12px;border:1px solid #ddd;text-align:center;font-weight:bold;">${status}</td>
    </tr>`;
  }).join('\n');

  // 失败用例详情
  const failDetails = reports.flatMap(r =>
    r.tcResults
      .filter(tc => tc.result === 'FAIL')
      .map(tc => `<tr>
        <td style="padding:6px 12px;border:1px solid #ddd;">${tc.tcId}</td>
        <td style="padding:6px 12px;border:1px solid #ddd;">${r.module}</td>
        <td style="padding:6px 12px;border:1px solid #ddd;">${tc.name}</td>
        <td style="padding:6px 12px;border:1px solid #ddd;color:#e74c3c;font-weight:bold;">FAIL</td>
      </tr>`)
  ).join('\n');

  // 缺陷汇总
  const defectRows = reports.flatMap(r =>
    r.defects.map(d => {
      const severityColor = d.severity.includes('P0') ? '#e74c3c' : d.severity.includes('P1') ? '#f39c12' : '#3498db';
      return `<tr>
        <td style="padding:6px 12px;border:1px solid #ddd;color:${severityColor};font-weight:bold;">${d.severity}</td>
        <td style="padding:6px 12px;border:1px solid #ddd;">${d.tc}</td>
        <td style="padding:6px 12px;border:1px solid #ddd;">${d.desc}</td>
        <td style="padding:6px 12px;border:1px solid #ddd;">${d.suggestion}</td>
      </tr>`;
    })
  ).join('\n');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#333;max-width:800px;margin:0 auto;padding:20px;">

  <!-- 头部 -->
  <div style="background:linear-gradient(135deg,#2c3e50,#3498db);color:white;padding:24px;border-radius:8px 8px 0 0;">
    <h1 style="margin:0 0 8px 0;font-size:22px;">PM 自动化测试报告</h1>
    <p style="margin:0;opacity:0.9;font-size:14px;">
      ${statusEmoji} ${summary.project} &mdash; ${summary.totalPass}/${summary.total} 通过 (${summary.rate}%) &mdash; ${statusText}
    </p>
  </div>

  <!-- 基本信息 -->
  <div style="background:#f8f9fa;padding:16px 24px;border-left:3px solid #3498db;">
    <table style="font-size:14px;">
      <tr><td style="padding:4px 16px 4px 0;color:#666;">项目</td><td style="font-weight:bold;">${summary.project}</td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#666;">时间</td><td>${summary.time}</td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#666;">目标</td><td>${env.baseURL || '-'}</td></tr>
    </table>
  </div>

  <!-- 模块概览 -->
  <div style="padding:20px 0;">
    <h2 style="font-size:16px;border-bottom:2px solid #3498db;padding-bottom:8px;">模块概览</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#f1f3f5;">
        <th style="padding:8px 12px;border:1px solid #ddd;text-align:left;">模块</th>
        <th style="padding:8px 12px;border:1px solid #ddd;text-align:center;">通过</th>
        <th style="padding:8px 12px;border:1px solid #ddd;text-align:center;">失败</th>
        <th style="padding:8px 12px;border:1px solid #ddd;text-align:center;">跳过</th>
        <th style="padding:8px 12px;border:1px solid #ddd;text-align:center;">通过率</th>
      </tr>
      ${moduleRows}
    </table>
  </div>

  ${failDetails ? `
  <!-- 失败用例 -->
  <div style="padding:0 0 20px;">
    <h2 style="font-size:16px;border-bottom:2px solid #e74c3c;padding-bottom:8px;">失败用例</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#fdf0f0;">
        <th style="padding:6px 12px;border:1px solid #ddd;text-align:left;">编号</th>
        <th style="padding:6px 12px;border:1px solid #ddd;text-align:left;">模块</th>
        <th style="padding:6px 12px;border:1px solid #ddd;text-align:left;">用例名称</th>
        <th style="padding:6px 12px;border:1px solid #ddd;text-align:center;">结果</th>
      </tr>
      ${failDetails}
    </table>
  </div>
  ` : ''}

  ${defectRows ? `
  <!-- 缺陷汇总 -->
  <div style="padding:0 0 20px;">
    <h2 style="font-size:16px;border-bottom:2px solid #f39c12;padding-bottom:8px;">缺陷汇总</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#fef9f0;">
        <th style="padding:6px 12px;border:1px solid #ddd;text-align:left;">严重程度</th>
        <th style="padding:6px 12px;border:1px solid #ddd;text-align:left;">用例</th>
        <th style="padding:6px 12px;border:1px solid #ddd;text-align:left;">描述</th>
        <th style="padding:6px 12px;border:1px solid #ddd;text-align:left;">建议</th>
      </tr>
      ${defectRows}
    </table>
  </div>
  ` : ''}

  <!-- 页脚 -->
  <div style="border-top:1px solid #ddd;padding:12px 0;font-size:12px;color:#999;text-align:center;">
    PM 自动化测试中心 &mdash; 本邮件由系统自动发送
  </div>

</body>
</html>`;
}

// --- 主流程 ---
const summaryPath = join(projectDir, 'results', 'summary.md');
if (!existsSync(summaryPath)) {
  console.error(`测试汇总不存在: ${summaryPath}`);
  process.exit(1);
}

const summary = parseSummary(summaryPath);

// 判断是否需要发送
const hasFail = summary.modules.some(m => m.fail > 0);
if (!config.sendOn.always && !hasFail && !config.sendOn.onFail) {
  console.log('无失败用例且未配置 always 发送，跳过通知');
  process.exit(0);
}

// 读取所有模块报告
const resultsDir = join(projectDir, 'results');
const reports = [];
if (existsSync(resultsDir)) {
  const modules = readdirSync(resultsDir).filter(d => {
    return existsSync(join(resultsDir, d, 'report.md'));
  });
  for (const mod of modules) {
    reports.push(parseReport(join(resultsDir, mod, 'report.md')));
  }
}

// 打包报告目录为 zip
const attachments = [];
const zipAttachment = await packReportZip(projectDir, projectArg);
if (zipAttachment) attachments.push(zipAttachment);

// 收件人：项目级优先，全局兜底
const projectRecipients = env.notification?.recipients || [];
const recipients = projectRecipients.length > 0 ? projectRecipients : (config.recipients || []);

if (recipients.length === 0) {
  console.error('未配置收件人（config.recipients 或 environment.json notification.recipients）');
  process.exit(1);
}

// 构建邮件
const failedCount = summary.total - summary.totalPass;
const subject = `[PM] ${summary.project} 测试报告 - ${summary.totalPass}/${summary.total} 通过 (${summary.rate}%)${failedCount > 0 ? ` - ${failedCount} 个失败` : ''}`;
const html = renderEmail(summary, reports, attachments);

if (dryRun) {
  console.log('=== DRY RUN 模式（不发送邮件）===\n');
  console.log(`收件人: ${recipients.join(', ')}`);
  console.log(`主题: ${subject}`);
  console.log(`附件: ${attachments.map(a => a.filename).join(', ') || '无'}`);
  console.log('\n=== HTML 内容 ===\n');
  console.log(html);
  process.exit(0);
}

// 发送邮件
const transporter = nodemailer.createTransport(config.smtp);

try {
  const result = await transporter.sendMail({
    from: config.from,
    to: recipients.join(', '),
    subject,
    html,
    attachments,
  });
  console.log(`邮件已发送: ${result.messageId}`);
  console.log(`  收件人: ${recipients.join(', ')}`);
  console.log(`  主题: ${subject}`);
  console.log(`  附件: ${attachments.length} 个`);
} catch (err) {
  console.error('邮件发送失败:', err.message);
  process.exit(1);
}
