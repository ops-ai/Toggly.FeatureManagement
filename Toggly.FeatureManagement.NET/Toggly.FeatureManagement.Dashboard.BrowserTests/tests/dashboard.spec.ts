import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const mount = '/internal/features';

test('SQLite dashboard creates, targets, exports, evaluates and deletes a feature offline', async ({ page, request }, testInfo) => {
  const outbound: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') { outbound.push(url.href); return route.abort(); }
    return route.continue();
  });
  await page.goto(mount);
  const initialize = page.getByRole('button', { name: 'Initialize catalog', exact: true });
  if (await initialize.isVisible()) await initialize.click();
  await page.getByRole('link', { name: 'Create feature', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('New checkout');
  await page.getByLabel('Name', { exact: true }).press('Tab');
  await expect(page.getByLabel('Key', { exact: true })).toBeFocused();
  await page.keyboard.type('NewCheckout');
  await page.getByLabel('Description', { exact: true }).fill('<script>alert("unsafe")</script>');
  await page.getByLabel('New rule type').selectOption('Targeting');
  await page.getByRole('button', { name: 'Add rule', exact: true }).click();
  await expect(page.getByLabel('Default rollout percentage')).toHaveValue('0');
  await page.getByLabel('Users', { exact: true }).fill('alice\nuser,with,commas');
  await page.getByLabel('Excluded users', { exact: true }).fill('bob');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${mount}/?$`));
  await expect(page.getByText('<script>alert("unsafe")</script>', { exact: true })).toBeVisible();
  expect(await page.locator('script').evaluateAll(elements => elements.some(element => element.textContent?.includes('unsafe')))).toBe(false);
  const row = page.getByRole('row').filter({ hasText: 'New checkout' });
  await expect(row.getByText('Disabled', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('feature-list.png'), fullPage: true });
  const exported = await request.get(`${mount}/export`);
  expect(exported.ok()).toBe(true);
  const document = await exported.json();
  const feature = document.features.find((item: { key: string }) => item.key === 'NewCheckout');
  expect(feature.enabled).toBe(false);
  expect(feature.rules[0].parameters['Audience.Users:1']).toBe('user,with,commas');
  expect(feature.rules[0].parameters['Audience.Exclusion.Users:0']).toBe('bob');
  await row.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Users', { exact: true })).toHaveValue('alice\nuser,with,commas');
  await page.getByRole('button', { name: 'Remove rule', exact: true }).click();
  await page.getByLabel('Enabled', { exact: true }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(await (await request.get('/checkout')).json()).toEqual({ newCheckout: true });
  await page.goto(mount);
  await page.getByRole('button', { name: 'Disable', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${mount}/?$`));
  expect(await (await request.get('/checkout')).json()).toEqual({ newCheckout: false });
  await page.goto(`${mount}/features/delete?key=NewCheckout`);
  await page.getByRole('button', { name: /Delete/i }).click();
  expect(await (await request.get('/checkout')).json()).toEqual({ newCheckout: false });
  expect(outbound).toEqual([]);
});

test('upload preview and download preserve disabled rules without JavaScript', async ({ page }) => {
  const key = 'Imported';
  await page.goto(`${mount}/import`);
  await page.locator('input[type=file]').setInputFiles({ name: 'catalog.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    schemaVersion: 1, environment: 'Production', contexts: [], features: [
      { key, name: 'Imported feature', description: '', tags: [], enabled: false, requirementType: 'Any', contextKind: null, contextRequirementType: null,
        rules: [{ name: 'Percentage', parameters: { Value: '25' } }] }
    ]
  })) });
  await page.getByRole('button', { name: /Preview/i }).click();
  await expect(page.getByRole('heading', { name: 'Import preview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apply selected changes', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.goto(`${mount}/import`);
  await page.getByRole('link', { name: 'Export catalog', exact: true }).click();
  const download = await downloadPromise;
  const document = JSON.parse(await readFile((await download.path())!, 'utf8'));
  const imported = document.features.find((item: { key: string }) => item.key === key);
  expect(imported.enabled).toBe(false);
  expect(imported.rules).toEqual([{ name: 'Percentage', parameters: { Value: '25' } }]);
  await page.goto(`${mount}/features/delete?key=${key}`);
  await page.getByRole('button', { name: /Delete/i }).click();
});
