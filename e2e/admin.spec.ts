import { expect, test } from '@playwright/test';

test('fixed admin logs in, keeps preferences across sessions and sees the selected AI provider', async ({
  page,
}) => {
  await page.route('**/api/coach/status', (route) =>
    route.fulfill({
      json: { available: true, provider: 'bedrock', message: '接続は初回の相談時に確認します' },
    }),
  );
  await page.goto('/');
  await expect(
    page.getByText('組織のアカウント、または admin でログインしてください。'),
  ).toBeVisible();
  await page.getByLabel('ユーザー名').fill('admin');
  await page.getByLabel('パスワード').fill('wrong');
  await page.getByRole('button', { name: 'ログインして訓練を開始' }).click();
  await expect(page.getByRole('alert')).toContainText('ユーザー名またはパスワード');
  await page.getByLabel('パスワード').fill('e2e-only-admin-password');
  await page.getByRole('button', { name: 'ログインして訓練を開始' }).click();
  await expect(page.locator('.operator b')).toHaveText('admin');
  await expect(page.locator('.coach-identity')).toContainText('Amazon Bedrock / AI COACH');
  await page.getByRole('button', { name: '訓練設定', exact: true }).click();
  await page.getByRole('spinbutton', { name: '送受信速度' }).fill('7');
  await page.getByRole('button', { name: '設定を保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('設定を保存');
  await page.getByRole('button', { name: 'ログアウト' }).click();
  await expect(page.getByRole('heading', { name: '訓練ステーションに入室' })).toBeVisible();
  expect((await page.request.get('/api/preferences')).status()).toBe(401);
  await page.getByLabel('ユーザー名').fill('admin');
  await page.getByLabel('パスワード').fill('e2e-only-admin-password');
  await page.getByRole('button', { name: 'ログインして訓練を開始' }).click();
  await expect(page.getByRole('heading', { name: '送信訓練', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '訓練設定', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '送受信速度' })).toHaveValue('7');
  await expect(page.locator('body')).not.toContainText('e2e-only-admin-password');
});
