import { evaluate } from './evaluate';
import { test, expect } from '@playwright/test';
const definitions = process.env.TOGGLY_HOST_DEFINITIONS!;
test('packed browser telemetry preserves hydration, route queues, lifecycle and terminal ownership', async ({
  page,
  request,
  browser,
}) => {
  console.log('Actual Chromium', browser.version());
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
    u: 'alice',
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
  expect(packets).toHaveLength(3);
  expect(packets[1].body.m).toEqual({ orders: 2, cart: 3.5 });
  expect(packets[1].body.f.checkout['variant-a']).toEqual([0, 1, 1]);
  expect(packets[1].body.u).toBe('alice');
  expect(packets[2].body.u).toBe('bob');
  expect(packets[2].body.f.on.disabled[0]).toBeGreaterThan(0);
  expect(JSON.stringify(packets)).not.toMatch(/identity|privateClaim|server-secret/);
  expect(
    packets.every(
      (packet: any) =>
        packet.body.i === undefined && !('groups' in packet.body) && !('claims' in packet.body),
    ),
  ).toBe(true);
  expect(await evaluate(page, () => (window as any).telemetryOptions.at(-1))).toEqual({
    keepalive: false,
    credentials: 'omit',
    encoding: 'gzip',
  });
  for (const event of ['hidden', 'pagehide']) {
    await page.getByRole('button', { name: 'Record telemetry', exact: true }).click();
    const before = (await state()).telemetry.length;
    await evaluate(
      page,
      (event) => {
        if (event === 'hidden') {
          Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
          });
          document.dispatchEvent(new Event('visibilitychange'));
        } else window.dispatchEvent(new PageTransitionEvent('pagehide'));
      },
      event,
    );
    await expect.poll(async () => (await state()).telemetry.length).toBe(before + 1);
    expect((await state()).telemetry.at(-1).headers['content-encoding']).toBeUndefined();
    expect(await evaluate(page, () => (window as any).telemetryOptions.at(-1))).toEqual({
      keepalive: true,
      credentials: 'omit',
      encoding: null,
    });
    await evaluate(page, () =>
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }),
    );
  }
  await page.getByRole('button', { name: 'Record telemetry', exact: true }).click();
  const before = (await state()).telemetry.length;
  await page.getByRole('button', { name: 'Toggle owner' }).click();
  await expect.poll(async () => (await state()).telemetry.length).toBe(before + 1);
  expect((await state()).telemetry.at(-1).headers['content-encoding']).toBeUndefined();
  expect(await evaluate(page, () => (window as any).telemetryOptions.at(-1))).toEqual({
    keepalive: true,
    credentials: 'omit',
    encoding: null,
  });
  const retired = await state();
  await request.post(definitions + '/control', {
    data: { release: true, delayUser: '', delayBrowserUser: '' },
  });
  await evaluate(page, () => {
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

test('projected tokens preserve signed SSR and browser results while navigation clears attribution', async ({
  page,
  request,
}) => {
  const state = async () => await (await request.get(definitions + '/state')).json();
  await request.post(definitions + '/control', {
    data: {
      enabled: true,
      invalid: false,
      shape: null,
      offline: false,
      delayUser: '',
      delayBrowserUser: '',
      release: true,
      telemetry: [],
      requests: [],
    },
  });
  const html = await (await request.get('/one?user=alice&instance=token-a')).text();
  expect(html).toContain('data-testid="on"');
  expect(html).toContain('token-a');
  expect(html).not.toMatch(/server-secret|backend-private-fixture|not-exposed/);
  expect((await state()).telemetry).toEqual([]);
  // Hold browser responses so these assertions measure committed hydration once.
  await page.route('**/evaluated-signed/**', (route) => route.abort());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/one?user=alice&instance=token-a');
  await expect(page.getByTestId('on')).toBeVisible();
  await expect(page.getByTestId('vip')).toHaveText('true');
  await expect(page.getByTestId('no-entity')).toHaveText('false');
  await page.getByRole('button', { name: 'Record telemetry', exact: true }).click();
  await page.getByRole('button', { name: 'Flush telemetry', exact: true }).click();
  await expect(page.getByTestId('telemetry-status')).toHaveText('flushed');
  let packets = (await state()).telemetry;
  expect(packets).toHaveLength(1);
  expect(packets[0].body).toEqual({
    k: 'frontend-fixture',
    e: 'Fixture',
    i: 'token-a',
    f: {
      on: { enabled: [4] },
      off: { disabled: [1] },
      Order: { enabled: [1], disabled: [1] },
      checkout: { 'variant-a': [0, 1, 1] },
    },
    m: { orders: 2, cart: 3.5 },
  });
  await page.getByRole('button', { name: 'Record telemetry', exact: true }).click();
  await page.getByRole('link', { name: 'Minted Bob', exact: true }).click();
  await expect(page.getByTestId('off')).toBeVisible();
  expect((await state()).telemetry).toHaveLength(1);
  await page.getByRole('button', { name: 'Record telemetry', exact: true }).click();
  await page.getByRole('link', { name: 'Alice', exact: true }).click();
  await expect(page.getByTestId('on')).toBeVisible();
  await expect(page.getByTestId('snapshot')).not.toContainText('token-');
  await page.getByRole('button', { name: 'Record telemetry', exact: true }).click();
  await page.getByRole('button', { name: 'Flush telemetry', exact: true }).click();
  await expect(page.getByTestId('telemetry-status')).toHaveText('flushed');
  packets = (await state()).telemetry;
  expect(packets.map((p: any) => [p.body.i, p.body.u])).toEqual([
    ['token-a', undefined],
    ['token-a', undefined],
    ['token-b', undefined],
    [undefined, 'alice'],
  ]);
  expect(
    packets
      .slice(1)
      .every(
        (p: any) =>
          p.body.f.checkout['variant-a'].join() === '0,1,1' &&
          p.body.m.orders === 2 &&
          p.body.m.cart === 3.5,
      ),
  ).toBe(true);
  const projected = (await state()).requests.filter((r: any) => r.instanceId);
  expect(projected.some((r: any) => r.instanceId === 'token-a')).toBe(true);
  expect(projected.some((r: any) => r.instanceId === 'token-b')).toBe(true);
  expect(
    projected.every((r: any) => r.user === null && r.groups.length === 0 && r.claims === null),
  ).toBe(true);
  // Now allow actual browser requests; the cleared snapshot must use only u=alice.
  await page.unroute('**/evaluated-signed/**');
  await expect
    .poll(async () =>
      (await state()).requests.some(
        (r: any) => r.browser && r.user === 'alice' && r.instanceId === null,
      ),
    )
    .toBe(true);
  await page.getByRole('link', { name: 'Minted Alice', exact: true }).click();
  await expect(page.getByTestId('on')).toBeVisible();
  await expect
    .poll(async () =>
      (await state()).requests.some(
        (r: any) =>
          r.browser &&
          r.instanceId === 'token-a' &&
          r.user === null &&
          r.groups.length === 0 &&
          r.claims === null,
      ),
    )
    .toBe(true);
  await expect(page.getByTestId('snapshot')).toContainText('token-a');
  await page.getByRole('button', { name: 'Toggle owner' }).click();
  expect(errors).toEqual([]);
});
