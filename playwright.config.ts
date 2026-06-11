import { defineConfig } from '@playwright/test';

// 全局安全网配置 — 防止 MCP server 在根目录创建 test-results/ 和散落文件
// 实际测试运行必须使用项目级配置：--config=test_project/<NN-Project>/playwright.config.ts
export default defineConfig({
  testDir: '.',
  timeout: 60000,
  outputDir: '.claude/test-artifacts',
  use: {
    baseURL: 'http://localhost:80',
    actionTimeout: 3000,
    headless: true,
    screenshot: 'on',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
