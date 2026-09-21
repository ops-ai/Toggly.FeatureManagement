import { test, expect } from '@playwright/test';
const definitions = process.env.TOGGLY_HOST_DEFINITIONS!;
test('packed browser telemetry preserves hydration, route queues, lifecycle and terminal ownership', async ({
  page,
  request,
  browser,
}) => {
  const state = async () => await (await request.get(definitions + '/state')).json();
  await request.post(definitions + '/control', {
    data: {
      enabled: true,
      invalid: false,
      shape: null,
      offline: false,
      delayUser: '',
      delayBrowserUser: 'alice',
      telemetry: [],
      telemetryPreflights: [],
    },
  });
  const html = await (await request.get('/one?user=alice')).text();
  expect(html).toContain('data-testid="on"');
  expect((await state()).telemetry).toEqual([]);
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    (window as any).telemetryOptions = [];
    window.fetch = (input, options) => {
      if (String(input).includes('/api/frontend/telemetry'))
        (window as any).telemetryOptions.push({
          keepalive: options?.keepalive,
          credentials: options?.credentials,
          encoding: (options?.headers as Record<string, string>)?.['Content-Encoding'] ?? null,
        });
      return original(input, options);
    };
  });
  await page.goto('/one?user=alice');
  await expect(page.getByTestId('on')).toBeVisible();
  await page.getByRole('button', { name: 'Flush telemetry', exact: true }).click();
  await expect(page.getByTestId('telemetry-status')).toHaveText('flushed');
  let packets = (await state()).telemetry;
  expect(packets).toHaveLength(1);
  expect(packets[0].body).toEqual({
    k: 'frontend-fixture',
    e: 'Fixture',
    f: { on: { enabled: [4] }, off: { disabled: [1] }, Order: { enabled: [1], disabled: [1] } },
  });
  expect(packets[0].headers['content-encoding']).toBe('gzip');
  expect(packets[0].headers.origin).toBe(new URL(page.url()).origin);
  expect(packets[0].headers.authorization).toBeUndefined();
  expect(packets[0].headers.cookie).toBeUndefined();
  expect(packets[0].bytes).toBeLessThanOrEqual(49152);
  expect((await state()).telemetryPreflights.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Record telemetry', exact: true }).click();
  await page.getByRole('link', { name: 'Bob', exact: true }).click();
  await expect(page.getByTestId('off')).toBeVisible();
  expect((await state()).telemetry).toHaveLength(1); // Route reconnection cannot dispose/flush the owner.
  await page.getByRole('button', { name: 'Flush telemetry', exact: true }).click();
  await expect(page.getByTestId('telemetry-status')).toHaveText('flushed');
  packets = (await state()).telemetry;
  expect(packets).toHaveLength(2);
  expect(packets[1].body.m).toEqual({ orders: 2, cart: 3.5 });
  expect(packets[1].body.f.checkout['variant-a']).toEqual([0, 1, 1]);
  expect(JSON.stringify(packets[1].body)).not.toMatch(/alice|bob|identity|groups|claims/);
  expect(await page.evaluate(() => (window as any).telemetryOptions.at(-1))).toEqual({
    keepalive: false,
    credentials: 'omit',
    encoding: 'gzip',
  });
  for (const event of ['hidden', 'pagehide']) {
    await page.getByRole('button', { name: 'Record telemetry', exact: true }).click();
    const before = (await state()).telemetry.length;
    await page.evaluate((event) => {
      if (event === 'hidden') {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      } else window.dispatchEvent(new PageTransitionEvent('pagehide'));
    }, event);
    await expect.poll(async () => (await state()).telemetry.length).toBe(before + 1);
    expect((await state()).telemetry.at(-1).headers['content-encoding']).toBeUndefined();
    expect(await page.evaluate(() => (window as any).telemetryOptions.at(-1))).toEqual({
      keepalive: true,
      credentials: 'omit',
      encoding: null,
    });
    await page.evaluate(() =>
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }),
    );
  }
  await page.getByRole('button', { name: 'Record telemetry', exact: true }).click();
  const before = (await state()).telemetry.length;
  await page.getByRole('button', { name: 'Toggle owner' }).click();
  await expect.poll(async () => (await state()).telemetry.length).toBe(before + 1);
  expect((await state()).telemetry.at(-1).headers['content-encoding']).toBeUndefined();
  expect(await page.evaluate(() => (window as any).telemetryOptions.at(-1))).toEqual({
    keepalive: true,
    credentials: 'omit',
    encoding: null,
  });
  const retired = await state();
  await request.post(definitions + '/control', {
    data: { release: true, delayUser: '', delayBrowserUser: '' },
  });
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
  });
  await page.waitForTimeout(350);
  expect((await state()).telemetry).toHaveLength(before + 1);
  expect((await state()).connections).toBe(retired.connections);
  expect((await state()).requests).toHaveLength(retired.requests.length);
  for (const query of ['telemetry=false', 'frontendKey=']) {
    const silent = await browser.newPage();
    await silent.goto(new URL('/one?user=alice&' + query, page.url()).toString());
    await expect(silent.getByTestId('on')).toBeVisible();
    await silent.getByRole('button', { name: 'Record telemetry', exact: true }).click();
    await silent.getByRole('button', { name: 'Flush telemetry', exact: true }).click();
    await expect(silent.getByTestId('telemetry-status')).toHaveText('flushed');
    await silent.getByRole('button', { name: 'Toggle owner' }).click();
    await silent.close();
    expect((await state()).telemetry).toHaveLength(before + 1);
  }
});
