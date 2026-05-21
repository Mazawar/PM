# TEST-ID: TP-<项目编号>-L3-001
# TEST-NAME: <E2E测试名称>
# TEST-LEVEL: L3
# TEST-TARGET: <完整业务流程名称>
# TEST-PREREQUISITE: 完整应用栈已启动，测试数据已初始化
# TEST-STEPS: 步骤1 -> 步骤2 -> ... -> 步骤N
# TEST-EXPECTED: 完整流程执行成功，最终状态正确

# === Playwright (TypeScript) 示例 ===
# import { test, expect } from '@playwright/test';
#
# test('完整用户注册登录流程', async ({ page }) => {
#     // 1. 访问注册页
#     await page.goto('http://localhost:80/register');
#     await page.fill('[name="username"]', 'e2e-test-user');
#     await page.fill('[name="password"]', 'Test@123');
#     await page.click('button[type="submit"]');
#
#     // 2. 验证注册成功跳转
#     await expect(page).toHaveURL(/.*login/);
#
#     // 3. 登录
#     await page.fill('[name="username"]', 'e2e-test-user');
#     await page.fill('[name="password"]', 'Test@123');
#     await page.click('button[type="submit"]');
#
#     // 4. 验证登录成功进入首页
#     await expect(page).toHaveURL(/.*home/);
#     await expect(page.locator('.welcome')).toContainText('e2e-test-user');
#
#     // 5. 验证数据持久化 — 通过 API 确认
#     const apiResponse = await page.request.get('/api/users/me');
#     expect(apiResponse.ok()).toBeTruthy();
# });

# === Python (Playwright) 示例 ===
# from playwright.sync_api import sync_playwright
#
# def test_user_register_login_flow(page):
#     # 1. 注册
#     page.goto("http://localhost:80/register")
#     page.fill('[name="username"]', 'e2e-test-user')
#     page.fill('[name="password"]', 'Test@123')
#     page.click('button[type="submit"]')
#
#     # 2. 验证跳转登录页
#     assert "/login" in page.url
#
#     # 3. 登录
#     page.fill('[name="username"]', 'e2e-test-user')
#     page.fill('[name="password"]', 'Test@123')
#     page.click('button[type="submit"]')
#
#     # 4. 验证进入首页
#     assert "/home" in page.url
#     assert page.locator(".welcome").is_visible()
