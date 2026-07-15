/**
 * HTMLRewriter transformer for section-level feature gating.
 *
 * Two responsibilities, applied in a single streaming pass:
 *
 *  1. Strip `[data-feature]` elements whose flag is disabled, so disabled
 *     content never reaches the browser.
 *  2. Inject a synchronous `<script>` snapshot of the resolved flag map at
 *     the start of `<head>` as `window.__TOGGLY_EDGE_FLAGS__`. The Docusaurus
 *     plugin's React Provider reads this on first client render so the React
 *     tree matches the post-strip DOM and React 18 hydration succeeds. Without
 *     this snapshot, hydration mismatches produce console errors and a full
 *     client-side re-render of the page root.
 */

/** Global the client SDK reads on first render to align with edge state. */
const SNAPSHOT_GLOBAL = '__TOGGLY_EDGE_FLAGS__';

/**
 * Build the inline script element that pins `flags` onto the snapshot global.
 *
 * `</script` is escaped defensively so a flag key/value containing the
 * sequence cannot break out of the script tag. Keep this replace in sync with
 * `@ops-ai/toggly-hooks-types` `serializeJsonForInlineScript`.
 * `JSON.stringify` already handles HTML-significant characters inside string
 * values; this guards the one structural sequence that JSON would not otherwise escape.
 */
function buildSnapshotScript(flags: Record<string, boolean>): string {
  const safeJson = JSON.stringify(flags).replace(/<\/script/gi, '<\\/script');
  return `<script>window.${SNAPSHOT_GLOBAL}=${safeJson};</script>`;
}

/**
 * Create an HTMLRewriter that strips disabled feature sections AND injects
 * the flag snapshot into `<head>`.
 */
export function createFeatureGateTransformer(flags: Record<string, boolean>) {
  const snapshot = buildSnapshotScript(flags);

  return new HTMLRewriter()
    .on('[data-feature]', {
      element(element: Element) {
        const featureKey = element.getAttribute('data-feature');
        if (featureKey && !flags[featureKey]) {
          element.remove();
        }
      },
    })
    .on('head', {
      element(element: Element) {
        // Prepend so the global is set before any deferred bundle script runs
        // and reads it during React hydration.
        element.prepend(snapshot, { html: true });
      },
    });
}

/**
 * Transform an HTML response by stripping disabled sections and injecting
 * the flag snapshot. Streams the response body through HTMLRewriter so we
 * never buffer the full document.
 */
export function transformHtmlResponse(
  response: Response,
  flags: Record<string, boolean>
): Response {
  if (!response.body) {
    return response;
  }

  const transformer = createFeatureGateTransformer(flags);
  const transformed = transformer.transform(response);

  const headers = new Headers(transformed.headers);
  headers.delete('Content-Length');

  return new Response(transformed.body, {
    status: transformed.status,
    statusText: transformed.statusText,
    headers,
  });
}
