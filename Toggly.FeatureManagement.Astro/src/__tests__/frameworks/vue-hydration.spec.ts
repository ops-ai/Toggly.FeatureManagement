import { afterEach, expect, it } from 'vitest';
import { createSSRApp, h, nextTick, type App } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { useFeatureFlag } from '../../frameworks/vue/composables.js';
import { $flags, $isReady, __resetClient } from '../../client/store.js';

let app: App | undefined;
afterEach(() => { app?.unmount(); __resetClient(); document.body.innerHTML = ''; });
it('hydrates the server loading state when flags arrive before the Vue island', async () => {
  __resetClient();
  const Island = { setup() {
    const { enabled, isReady } = useFeatureFlag('Visible');
    return () => h('output', isReady.value ? String(enabled.value) : 'loading');
  } };
  const container = document.createElement('div');
  container.innerHTML = await renderToString(createSSRApp(Island));
  document.body.append(container);
  $flags.set({ Visible: true }); $isReady.set(true);
  const warnings: string[] = [];
  app = createSSRApp(Island);
  app.config.warnHandler = warning => warnings.push(warning);
  app.mount(container);
  await nextTick();
  expect(warnings).toEqual([]);
  expect(container.textContent).toBe('true');
  $flags.set({ Visible: false });
  await nextTick();
  expect(container.textContent).toBe('false');
});
