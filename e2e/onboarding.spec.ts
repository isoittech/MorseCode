import { expect, test, type Page } from '@playwright/test';

async function firstVisit(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '体験モードで画面を確認' }).click();
  await expect(page.getByRole('heading', { name: 'モールス信号とは？' })).toBeVisible();
}

async function introPulse(page: Page, duration: number) {
  await page.getByRole('button', { name: '入門の打鍵キー' }).focus();
  await page.keyboard.down('Space');
  await page.waitForTimeout(duration);
  await page.keyboard.up('Space');
}

async function expectTourInViewport(page: Page) {
  const tooltip = page.getByRole('dialog');
  await expect(tooltip).toBeVisible();
  await expect(page.locator('.react-joyride__floater')).toHaveCSS('opacity', '1');
  await expect(page.locator('.react-joyride__spotlight path').nth(1)).toHaveCSS('opacity', '0');
  await expect
    .poll(async () => {
      const bounds = await tooltip.boundingBox();
      const size = page.viewportSize()!;
      return (
        !!bounds &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= size.width + 1 &&
        bounds.y + bounds.height <= size.height + 1
      );
    })
    .toBe(true);
}

test('beginners hear and key E T A, retry mistakes and keep practice out of their record', async ({
  page,
}) => {
  await firstVisit(page);
  await page.screenshot({ path: 'test-results/introduction.png', fullPage: true });
  for (const letter of ['E', 'T', 'A']) {
    const sound = page.getByRole('button', { name: `${letter}のお手本を聴く` });
    await sound.click();
    await expect(sound).toContainText('再生中');
    await expect(sound).toBeEnabled();
  }
  await page.getByRole('button', { name: '一文字打ってみる' }).click();
  await introPulse(page, 680);
  await expect(page.locator('.intro-feedback')).toContainText('今の入力は「T」');
  await expect(page.getByRole('button', { name: '次は「T」' })).toHaveCount(0);
  await page.getByRole('button', { name: 'もう一度', exact: true }).click();
  await introPulse(page, 240);
  await expect(page.locator('.intro-feedback')).toContainText('できました');
  await page.getByRole('button', { name: '次は「T」' }).click();
  const key = page.getByRole('button', { name: '入門の打鍵キー' });
  await key.hover();
  await page.mouse.down();
  await page.waitForTimeout(720);
  await page.mouse.up();
  await expect(page.locator('.intro-feedback')).toContainText('「T」になりました');
  await page.getByRole('button', { name: '次は「A」' }).click();
  await introPulse(page, 240);
  await page.waitForTimeout(150);
  await introPulse(page, 720);
  await expect(page.locator('.intro-feedback')).toContainText('「A」になりました');
  await page.screenshot({ path: 'test-results/first-key.png', fullPage: true });
  await page.getByRole('button', { name: '画面の使い方へ' }).click();
  await expect(page.getByRole('button', { name: '操作ガイドを始める' })).toBeVisible();
  expect(await (await page.request.get('/api/stats')).json()).toMatchObject({ total: 0 });
  await page.getByRole('button', { name: '入門をスキップして訓練へ' }).click();
  await expect(page.getByRole('heading', { name: '送信訓練', exact: true })).toBeVisible();
  await expect
    .poll(async () => (await (await page.request.get('/api/preferences')).json()).onboarding_seen)
    .toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '送信訓練', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'はじめてのモールス', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'モールス信号とは？' })).toBeVisible();
});

test('Joyride covers all six targets, supports back and suppresses keying until finished', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await firstVisit(page);
  await page.getByRole('checkbox', { name: /判定後にAI/ }).uncheck();
  await page.getByRole('button', { name: '操作ガイドへ進む' }).click();
  await expect(page.getByRole('heading', { name: 'まずは「送信訓練」から' })).toBeVisible();
  await expect(page.getByRole('button', { name: '打鍵キー', exact: true })).toBeDisabled();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.down('Space');
  await page.waitForTimeout(120);
  await page.keyboard.up('Space');
  await expect(page.locator('.signal-readout strong')).toHaveText('—');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'お題の文字を確認する' })).toBeVisible();
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'まずは「送信訓練」から' })).toBeVisible();
  const titles = [
    'お題の文字を確認する',
    '短く押して「トン」、長く押して「ツー」',
    '少し待つと、一文字が確定',
    '全部打てたら「判定する」',
    '迷ったら、コーチに聞く',
  ];
  for (const title of titles) {
    await page.getByRole('button', { name: '次へ', exact: true }).click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expectTourInViewport(page);
    if (title === titles[0])
      await page.screenshot({ path: 'test-results/walkthrough.png', fullPage: true });
  }
  await page.getByRole('button', { name: '練習を始める', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const key = page.getByRole('button', { name: '打鍵キー', exact: true });
  await expect(key).toBeEnabled();
  await key.focus();
  await page.keyboard.down('Space');
  await page.waitForTimeout(100);
  await page.keyboard.up('Space');
  await expect(page.locator('.signal-readout strong')).toHaveText('E');
  expect(errors).toEqual([]);
});

test('mobile guides can be replayed, skipped and escaped even if saving the first-visit flag fails', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await firstVisit(page);
  await page.route('**/api/onboarding/seen', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: '保存接続を確認してください' }),
    }),
  );
  await page.getByRole('button', { name: '入門をスキップして訓練へ' }).click();
  await expect(page.getByRole('heading', { name: '送信訓練', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('練習は続けられます');
  await page.unroute('**/api/onboarding/seen');
  await page.getByRole('button', { name: '表示済み状態の保存を再試行' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'はじめてのモールス', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/introduction-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '操作ガイドへ進む' }).click();
  await expectTourInViewport(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '操作ガイド', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'まずは「送信訓練」から' })).toBeVisible();
  await page.getByRole('button', { name: 'スキップ', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '操作ガイド', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'まずは「送信訓練」から' })).toBeVisible();
  for (let index = 1; index <= 6; index++) {
    await expect(page.getByRole('dialog')).toContainText(`操作ガイド · ${index} / 6`);
    await expectTourInViewport(page);
    if (index < 6) await page.getByRole('button', { name: '次へ', exact: true }).click();
  }
  await page.screenshot({ path: 'test-results/walkthrough-mobile.png' });
  await page.getByRole('button', { name: '操作ガイドを終了', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打鍵キー', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
