#!/usr/bin/env node

/**
 * PM 管线状态初始化脚本
 *
 * 初始化 test_project/<NN-Project>/.pipeline-state.json。
 * 文件不存在时自动创建模板（global / modules / publishes 三段结构）。
 * 已存在时跳过（幂等）。
 *
 * 用法:
 *   node .claude/scripts/pipeline-state.mjs --project <NN-Project>
 *   node .claude/scripts/pipeline-state.mjs --project <NN-Project> --dry-run
 *
 * 作为 ESM 模块导入时，导出 readState / updateStage / appendPublish。
 * 模块模式下不执行 CLI 逻辑。
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const STAGES_MODULE = ['Plan', 'Generate', 'Execute', 'Report'];
const STAGES_GLOBAL = ['Detect', 'Analyze', 'Build', 'Validate'];

const PROJECT_ROOT = resolve(import.meta.dirname, '../..');

// --- 工具函数（无副作用，供 CLI 和导出函数共用） ---

function statePathFor(projectPath) {
  return join(projectPath, '.pipeline-state.json');
}

function readStateRaw(projectPath) {
  const p = statePathFor(projectPath);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch (err) {
    throw new Error(`解析 ${p} 失败: ${err.message}`);
  }
}

function emptyStage() {
  return { status: 'pending' };
}

function buildTemplate(projectName, modules) {
  const global = {};
  for (const s of STAGES_GLOBAL) global[s] = emptyStage();

  const mods = {};
  for (const name of modules) {
    const m = {};
    for (const s of STAGES_MODULE) m[s] = emptyStage();
    mods[name] = m;
  }

  return {
    schemaVersion: 1,
    project: projectName,
    updatedAt: new Date().toISOString(),
    global,
    modules: mods,
    publishes: [],
  };
}

function discoverModules(projectPath) {
  const testsDir = join(projectPath, 'tests');
  const seen = new Set();
  for (const level of ['e2e', 'ui']) {
    const levelDir = join(testsDir, level);
    if (!existsSync(levelDir)) continue;
    for (const name of readdirSync(levelDir)) {
      if (name.startsWith('.')) continue;
      seen.add(name);
    }
  }
  return [...seen];
}

// --- 导出函数（ESM 模块 API） ---

export function readState(projectPath) {
  const obj = readStateRaw(projectPath);
  if (!obj) throw new Error(`State file not found: ${statePathFor(projectPath)}`);
  if (obj.schemaVersion !== 1) {
    throw new Error(`Unexpected schemaVersion: ${obj.schemaVersion}. Expected 1.`);
  }
  return obj;
}

export function updateStage(projectPath, scope, key, stage, data) {
  const state = readState(projectPath);
  const now = new Date().toISOString();

  if (scope === 'global') {
    if (!STAGES_GLOBAL.includes(stage)) throw new Error(`Invalid global stage: ${stage}`);
    state.global[stage] = { ...state.global[stage], ...data, at: now };
  } else if (scope === 'module') {
    if (!STAGES_MODULE.includes(stage)) throw new Error(`Invalid module stage: ${stage}`);
    if (!state.modules[key]) {
      const m = {};
      for (const s of STAGES_MODULE) m[s] = emptyStage();
      state.modules[key] = m;
    }
    state.modules[key][stage] = { ...state.modules[key][stage], ...data, at: now };
  } else {
    throw new Error(`Invalid scope: ${scope} (expected 'global' | 'module')`);
  }

  state.updatedAt = now;
  writeFileSync(statePathFor(projectPath), JSON.stringify(state, null, 2) + '\n', 'utf-8');
  return state;
}

export function appendPublish(projectPath, publish) {
  const state = readState(projectPath);
  if (!state.publishes) state.publishes = [];
  const id = state.publishes.length === 0
    ? 1
    : Math.max(...state.publishes.map(x => x.id || 0)) + 1;
  state.publishes.push({ id, ...publish });
  state.updatedAt = new Date().toISOString();
  writeFileSync(statePathFor(projectPath), JSON.stringify(state, null, 2) + '\n', 'utf-8');
  return state.publishes[state.publishes.length - 1];
}

// --- CLI 入口（仅当 --project 存在时执行） ---

function runCli() {
  const args = process.argv.slice(2);
  const projectIdx = args.indexOf('--project');
  const projectName = projectIdx >= 0 ? args[projectIdx + 1] : null;
  const dryRun = args.includes('--dry-run');

  if (!projectName) {
    console.error('用法: node pipeline-state.mjs --project <NN-Project> [--dry-run]');
    process.exit(1);
  }

  const projectDir = join(PROJECT_ROOT, 'test_project', projectName);
  if (!existsSync(projectDir)) {
    console.error(`项目目录不存在: ${projectDir}`);
    process.exit(1);
  }

  const statePath = statePathFor(projectDir);
  const log = (action, detail) => {
    const prefix = dryRun ? '[DRY-RUN]' : '[OK]';
    console.log(`  ${prefix} ${action}: ${detail}`);
  };

  const existing = (() => {
    if (!existsSync(statePath)) return null;
    try {
      return JSON.parse(readFileSync(statePath, 'utf-8'));
    } catch (err) {
      console.error(`[ERROR] 解析 ${statePath} 失败: ${err.message}`);
      process.exit(1);
    }
  })();

  // 情况 1：文件不存在 → 创建模板
  if (existing === null) {
    const modules = discoverModules(projectDir);
    const tmpl = buildTemplate(projectName, modules);
    log('CREATE', `模板（modules: [${modules.join(', ') || 'empty'}], publishes: []）`);
    if (!dryRun) writeFileSync(statePath, JSON.stringify(tmpl, null, 2) + '\n', 'utf-8');
    console.log(`\n结果: created`);
    return;
  }

  // 情况 2：已存在
  console.log(`  · 管线状态已存在（updatedAt: ${existing.updatedAt || 'unknown'}）`);
  console.log(`\n结果: skipped`);
}

// CLI 入口检测：仅在直接执行时跑（被 import 时跳过）
// process.argv[1] 在 --input-type=module 或某些环境下是 undefined，因此加保护
const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
if (import.meta.url === `file:///${invokedPath}` && invokedPath) {
  runCli();
}
