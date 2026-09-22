import {$gate, $isReady} from './store.js';

const subscriptions = new Map<HTMLElement, () => void>();

/** One subscription per element, across DOMContentLoaded and astro:page-load. */
export function hydrateFeatureClients(): void {
  if (typeof document === 'undefined') return;
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('.toggly-feature-client'))) {
    if (subscriptions.has(element)) continue;
    const flag = element.dataset.togglyFeature;
    const content = element.querySelector<HTMLElement>('[data-toggly-content]');
    if (!flag || !content) continue;
    const keys = flag.split(',').map(key => key.trim());
    const requirement = element.dataset.togglyRequirement === 'any' ? 'any' : 'all';
    const negate = element.dataset.togglyNegate === 'true';
    let context = null;
    try {context = JSON.parse(element.dataset.togglyContext ?? 'null');} catch { /* Invalid entity data fails closed. */ }
    let stopGate: (() => void) | undefined;
    const stopReady = $isReady.subscribe(ready => {
      if (!ready) {stopGate?.(); stopGate = undefined; content.style.display = 'none'; return;}
      if (stopGate) return;
      stopGate = $gate(keys, requirement, negate, context, element.dataset.togglyContextKind)
        .subscribe(enabled => {content.style.display = enabled ? '' : 'none';});
    });
    subscriptions.set(element, () => {stopGate?.(); stopReady();});
  }
}

/** Detach departing islands without disposing the browser store owner. */
export function cleanupFeatureClients(): void {
  for (const stop of subscriptions.values()) stop();
  subscriptions.clear();
}
