import { afterEach, beforeEach, expect, it } from 'vitest';
import React, { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Feature, useFeatureFlag } from '../../frameworks/react/Feature.js';
import { $flags, $isReady, __resetClient } from '../../client/store.js';

let root: Root | undefined;
let container: HTMLDivElement;
beforeEach(() => {
  __resetClient();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container.remove();
  __resetClient();
});

it('hydrates the server loading state when flags arrive before the React island', async () => {
  function Island() {
    const { enabled, isReady } = useFeatureFlag('Visible');
    return <><output>{isReady ? String(enabled) : 'loading'}</output>
      <Feature flag="Visible" loading={<span>waiting</span>}><p>enabled-content</p></Feature></>;
  }
  container.innerHTML = renderToString(<Island />);
  expect(container.textContent).toBe('loadingwaiting');
  $flags.set({ Visible: true });
  $isReady.set(true);
  const hydrationErrors: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(container, <Island />, { onRecoverableError: error => hydrationErrors.push(error) });
  });
  expect(hydrationErrors).toEqual([]);
  expect(container.textContent).toBe('trueenabled-content');
  await act(async () => { $flags.set({ Visible: false }); });
  expect(container.textContent).toBe('false');
});
