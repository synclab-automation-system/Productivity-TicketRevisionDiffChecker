import { chromium } from 'playwright';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const issueUrl = process.env.E2E_GITHUB_ISSUE_URL;
const token = process.env.GITHUB_TOKEN;
if (!issueUrl || !token) {
  console.error('Required: E2E_GITHUB_ISSUE_URL=<edited issue URL> GITHUB_TOKEN=<fine-grained PAT> npm run test:e2e:live');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});

try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;

  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/src/options.html`);
  await settings.locator('#token').fill(token);
  await settings.locator('#remember').uncheck();
  await settings.locator('#save').click();
  await settings.locator('#status').filter({ hasText: 'Đã lưu token' }).waitFor();
  await settings.close();

  const page = await context.newPage();
  await page.goto(issueUrl, { waitUntil: 'domcontentloaded' });
  const button = page.locator('[data-trdc-button="true"]');
  await button.waitFor({ timeout: 20000 });
  if (await button.count() !== 1) throw new Error('Expected exactly one Compare revisions button.');

  await button.click();
  await page.locator('[data-trdc-modal="true"]').waitFor();
  await page.locator('[data-trdc-diff="true"]').waitFor({ timeout: 20000 });
  const selects = page.locator('.trdc-select');
  if (await selects.count() !== 2) throw new Error('Expected Version A and Version B selectors.');

  await page.locator('[data-view="unified"]').click();
  await page.locator('.trdc-unified-table').waitFor();
  await page.locator('[data-view="side"]').click();
  await page.locator('.trdc-side-table').waitFor();
  await page.locator('[data-trdc-swap="true"]').click();
  await page.locator('[data-trdc-ignore-whitespace="true"]').check();

  console.log('PASS: live GitHub browser E2E smoke test');
  await page.waitForTimeout(1200);
} finally {
  await context.close();
}
