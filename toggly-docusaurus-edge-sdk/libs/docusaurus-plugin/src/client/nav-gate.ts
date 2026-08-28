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

import { createTogglyClient, type Flags } from '../lib/toggly-client.js';

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

  const config = (typeof window !== 'undefined' && (window as any).__TOGGLY_CONFIG__) || __TOGGLY_CONFIG__;
  const client = createTogglyClient(config);

  let flags: Flags = {};
  try {
    flags = await client.getFlags();
  } catch {
    // If flags cannot be fetched, fail open: do nothing to avoid hiding links incorrectly
    return;
  }

  // If we received no flags at all, fail open
  if (!flags || Object.keys(flags).length === 0) {
    return;
  }

  // Query all navbar links
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a.navbar__item, a.navbar__link, a.menu__link')
  );
  for (const link of links) {
    const path = normalizePath(link.getAttribute('href') || '');
    if (!path) continue;

    const feature = PAGE_FEATURES[path];
    if (!feature) continue;

    const enabled = flags[feature];
    // Hide when the feature is explicitly false or not truthy
    if (enabled !== true) {
      const parent = link.parentElement;
      if (parent && parent.childElementCount === 1) {
        parent.remove(); // remove the li if link is sole child
      } else {
        link.remove();
      }
    }
  }
}

if (typeof window !== 'undefined' && document?.addEventListener) {
  document.addEventListener('DOMContentLoaded', () => {
    void gateNavbar();
  });
}
