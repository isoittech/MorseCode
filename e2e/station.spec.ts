import { expect, test, type Page } from '@playwright/test';

async function enter(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '体験モードで画面を確認' }).click();
  await page.getByRole('button', { name: '入門をスキップして訓練へ' }).click();
  await expect(page.getByRole('heading', { name: '送信訓練', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: /判定後にAI/ }).uncheck();
}

async function pulse(page: Page, dash: boolean) {
  await page.keyboard.down('Space');
  await page.waitForTimeout(dash ? 300 : 100);
  await page.keyboard.up('Space');
  await page.waitForTimeout(80);
}

test('LDAP login errors remain actionable and demo sessions can log out', async ({ page }) => {
  await page.goto('/');
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'ユーザー名またはパスワードが正しくありません' }),
    }),
  );
  await page.getByLabel('ユーザー名').fill('wrong');
  await page.getByLabel('パスワード').fill('wrong');
  await page.getByRole('button', { name: 'ログインして訓練を開始' }).click();
  await expect(page.getByRole('alert')).toContainText('正しくありません');
  await page.getByRole('button', { name: '体験モードで画面を確認' }).click();
  await expect(page.getByRole('heading', { name: 'モールス信号とは？' })).toBeVisible();
  await page.getByRole('button', { name: 'ログアウト' }).click();
  await expect(page.getByRole('heading', { name: '訓練ステーションに入室' })).toBeVisible();
  expect((await page.request.get('/api/stats')).status()).toBe(401);
});

test('actual keyboard durations decode, grade and persist a complete mission', async ({ page }) => {
  await enter(page);
  await page.getByLabel('送信目標 KMK').click();
  for (const code of ['-.-', '--', '-.-']) {
    for (const symbol of code) await pulse(page, symbol === '-');
    await page.waitForTimeout(370);
  }
  await expect(page.locator('.signal-readout strong')).toHaveText('KMK');
  await expect(page.locator('.live-verdict')).toContainText('正確');
  await page.getByRole('button', { name: '判定する', exact: true }).click();
  await expect(page.getByText('任務完了。正確な通信だ。')).toBeVisible();
  await expect(page.locator('.metrics-strip')).toContainText('100');
  await page.getByRole('button', { name: '訓練記録', exact: true }).click();
  await expect(page.locator('.history-list')).toContainText('KMK');
  await page.reload();
  await expect(page.getByRole('heading', { name: '送信訓練' })).toBeVisible();
  await page.getByRole('button', { name: '訓練記録', exact: true }).click();
  await expect(page.locator('.history-list')).toContainText('KMK');
});

test('chat typing does not transmit and CopilotKit receives streamed contextual coaching', async ({
  page,
}) => {
  await enter(page);
  let observed = false;
  await page.route('**/api/coach', async (route) => {
    const request = route.request().postDataJSON();
    expect(request.context[0].value).toContain('KMK');
    observed = true;
    const events = [
      { type: 'RUN_STARTED', threadId: request.threadId, runId: request.runId },
      { type: 'TEXT_MESSAGE_START', messageId: 'reply', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'reply', delta: '短点1：長点3を意識しよう。' },
      { type: 'TEXT_MESSAGE_END', messageId: 'reply' },
      { type: 'RUN_FINISHED', threadId: request.threadId, runId: request.runId },
    ];
    await route.fulfill({
      contentType: 'text/event-stream',
      body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''),
    });
  });
  const input = page.getByRole('textbox', { name: 'コーチへのメッセージ' });
  await input.fill('打鍵の');
  await input.press('Space');
  await input.press('Space');
  await expect(page.locator('.signal-readout strong')).toHaveText('—');
  await input.fill('打鍵のコツは？');
  await page.getByRole('button', { name: 'メッセージを送信' }).click();
  await expect(page.locator('.chat-message.assistant')).toContainText('短点1：長点3');
  expect(observed).toBe(true);
});

test('all exercise modes, settings, reference and narrow screens work', async ({ page }) => {
  await enter(page);
  await page.getByRole('button', { name: '訓練設定', exact: true }).click();
  await page.getByRole('spinbutton', { name: '送受信速度' }).fill('18');
  await page.getByRole('button', { name: '設定を保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('設定を保存');
  await page.getByRole('button', { name: /受信訓練/ }).click();
  await expect(page.getByRole('heading', { name: '受信訓練', exact: true })).toBeVisible();
  await expect(page.locator('.current-signal')).toHaveText('18 WPM');
  await page.getByRole('button', { name: '信号を聴く', exact: true }).click();
  await expect(page.getByRole('button', { name: 'もう一度聴く' })).toBeVisible();
  await page.getByRole('textbox', { name: '受信した文字列' }).fill('XXX');
  await page.getByRole('button', { name: '判定する' }).click();
  await expect(page.locator('.result-banner')).toBeVisible();
  for (const label of ['知識ドリル', '判断ドリル']) {
    await page.getByRole('button', { name: new RegExp(label) }).click();
    await expect(page.getByRole('heading', { name: label })).toBeVisible();
    await page.locator('.quiz-option').first().click();
    await page.getByRole('button', { name: '判定する' }).click();
    await expect(page.locator('.result-banner')).toBeVisible();
  }
  await page.getByRole('button', { name: '符号リファレンス' }).click();
  await page.getByRole('textbox', { name: '符号を検索' }).fill('K');
  await expect(page.locator('.alphabet-grid button')).toHaveCount(1);
  await page.locator('.alphabet-grid button').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /送信訓練/ }).click();
  await expect(page.getByRole('button', { name: '打鍵キー', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

test('three-column desktop station is usable without a secure-context UUID API', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  });
  await enter(page);
  const [sidebar, console, coach] = await Promise.all([
    page.locator('.sidebar').boundingBox(),
    page.locator('.training-main').boundingBox(),
    page.locator('.coach-panel').boundingBox(),
  ]);
  expect(sidebar!.x + sidebar!.width).toBeLessThanOrEqual(console!.x + 1);
  expect(console!.x + console!.width).toBeLessThanOrEqual(coach!.x + 1);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/station.png', fullPage: true });
});

test('idle input mistakes trigger one automatic AI observation', async ({ page }) => {
  await enter(page);
  let requests = 0;
  await page.route('**/api/coach', async (route) => {
    requests++;
    const request = route.request().postDataJSON();
    expect(request.context[0].value).toContain('currentSignal');
    expect(request.messages.at(-1).content).toContain('入力途中');
    const events = [
      { type: 'RUN_STARTED', threadId: request.threadId, runId: request.runId },
      { type: 'TEXT_MESSAGE_START', messageId: 'live-reply', role: 'assistant' },
      {
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'live-reply',
        delta: 'Kは長点から始まる。最初の一打を見直そう。',
      },
      { type: 'TEXT_MESSAGE_END', messageId: 'live-reply' },
      { type: 'RUN_FINISHED', threadId: request.threadId, runId: request.runId },
    ];
    await route.fulfill({
      contentType: 'text/event-stream',
      body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''),
    });
  });
  await page.getByRole('checkbox', { name: /判定後にAI/ }).check();
  await page.getByLabel('送信目標 KMK').click();
  await pulse(page, false);
  await expect(page.locator('.live-verdict')).toContainText('異なる符号');
  await expect(page.locator('.chat-message.assistant')).toContainText('最初の一打');
  await pulse(page, false);
  await page.waitForTimeout(1900);
  expect(requests).toBe(1);
});

test('focus loss cancels a held key and coach failure leaves practice available', async ({
  page,
}) => {
  await enter(page);
  await page.getByLabel('送信目標 KMK').click();
  await page.keyboard.down('Space');
  await expect(page.getByRole('button', { name: '打鍵キー' })).toHaveClass(/pressed/);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('Space');
  await expect(page.getByRole('button', { name: '打鍵キー' })).not.toHaveClass(/pressed/);
  await expect(page.locator('.signal-readout strong')).toHaveText('—');
  await page.route('**/api/coach', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: 'data: {"type":"RUN_ERROR","message":"コーチは一時的に利用できません"}\n\n',
    }),
  );
  await page.getByRole('button', { name: '打鍵のコツ', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('コーチは一時的に利用できません');
  await page.getByRole('button', { name: '短点を入力', exact: true }).click();
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: '判定する' }).click();
  await expect(page.locator('.result-banner')).toBeVisible();
  await expect(page.locator('.metrics-strip')).toContainText('補助入力');
});
