/**
 * Navbar gating: hide or strip navbar links whose destination pages are gated off.
 *
 * This uses the page feature map (__TOGGLY_PAGE_FEATURES__) produced at build time
 * and live flag values fetched from Toggly using the same config injected for the docs.
 *
 * Behavior:
 * - If no page-feature mapping exists, it no-ops.
 * - For each navbar link, if its route matches the mapping and the flag is false,
 *   the link element is removed from the DOM.
 *
 * Notes:
 * - This runs client-side after DOMContentLoaded.
 * - It does not affect SSR HTML. For edge stripping, rely on the Cloudflare Worker
 *   reading the same mapping and using data-feature markers if desired.
 */

import { createTogglyClient, type Flags, type TogglyConfig } from '../lib/toggly-client.js';

declare const __TOGGLY_CONFIG__: any;
declare const __TOGGLY_PAGE_FEATURES__: Record<string, string>;

const PAGE_FEATURES: Record<string, string> =
  typeof __TOGGLY_PAGE_FEATURES__ === 'object' && __TOGGLY_PAGE_FEATURES__ !== null
    ? __TOGGLY_PAGE_FEATURES__
    : {};

function normalizePath(href: string): string | null {
  try {
    // Support relative and absolute links
    const url = new URL(href, window.location.origin);
    let p = url.pathname;
    // Remove trailing slash unless root
    if (p.length > 1 && p.endsWith('/')) {
      p = p.slice(0, -1);
    }
    return p;
  } catch {
    return null;
  }
}

async function gateNavbar(): Promise<void> {
  if (!PAGE_FEATURES || Object.keys(PAGE_FEATURES).length === 0) {
    return;
  }

  const client = createTogglyClient(readNavbarConfig());

  try {
    const flags = await fetchNavbarFlags(client);
    if (!flags) {
      return;
    }

    for (const link of navbarLinks()) {
      gateNavbarLink(link, flags, client);
    }
  } finally {
    client.dispose();
  }
}

function readNavbarConfig(): TogglyConfig | undefined {
  return (typeof window !== 'undefined' && (window as any).__TOGGLY_CONFIG__) || __TOGGLY_CONFIG__;
}

async function fetchNavbarFlags(client: ReturnType<typeof createTogglyClient>): Promise<Flags | null> {
  try {
    const flags = await client.getFlags();
    return Object.keys(flags).length > 0 ? flags : null;
  } catch {
    // If flags cannot be fetched, fail open: do nothing to avoid hiding links incorrectly.
    return null;
  }
}

function navbarLinks(): HTMLAnchorElement[] {
  return Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a.navbar__item, a.navbar__link, a.menu__link')
  );
}

function gateNavbarLink(
  link: HTMLAnchorElement,
  flags: Flags,
  client: ReturnType<typeof createTogglyClient>
): void {
  const path = normalizePath(link.getAttribute('href') || '');
  const feature = path ? PAGE_FEATURES[path] : undefined;
  if (!feature || client.evaluateFlag(feature, flags) === true) {
    return;
  }

  const parent = link.parentElement;
  if (parent?.childElementCount === 1) {
    parent.remove();
    return;
  }
  link.remove();
}

/** Docusaurus invokes this after SPA navigation updates the page's links. */
export function onRouteDidUpdate(): void {
  if (typeof window !== 'undefined') void gateNavbar();
}

if (typeof window !== 'undefined' && document?.addEventListener) {
  document.addEventListener('DOMContentLoaded', () => {
    void gateNavbar();
  });
}
