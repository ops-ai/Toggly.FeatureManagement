import { appendEvaluationContext } from '@ops-ai/toggly-hooks-types';
import type { TogglySnapshot } from './types.js';

/** The explicit public snapshot context owns browser evaluation targeting. */
export function buildBrowserDefinitionsUrl(
  baseURI: string,
  appKey: string,
  environment: string,
  context: TogglySnapshot['context'],
  enableVariants = false,
): string {
  const url = new URL(baseURI);
  const endpoint = enableVariants ? 'evaluated-variants-signed' : 'evaluated-signed';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${endpoint}/${appKey}/${environment}`;
  // The explicit snapshot owns the token, including its absence after navigation.
  url.searchParams.delete('i');
  const instanceId = context.instanceId?.trim();
  if (instanceId) {
    for (const key of [...url.searchParams.keys()]) {
      if (key === 'u' || key === 'userId' || key === 'g' || key.startsWith('claim.'))
        url.searchParams.delete(key);
    }
    url.searchParams.set('i', instanceId);
  } else appendEvaluationContext(url, context, enableVariants ? 'variants' : 'evaluated');
  return url.toString();
}

/** Fetch accepts these three URL representations; never stringify a Request object. */
function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Capture the exact response bytes for optional signed-envelope persistence. */
export function captureEvaluatedResponse(fetchImpl: typeof fetch) {
  let body: string | undefined;
  const capturedFetch: typeof fetch = async (input, init) => {
    const response = await fetchImpl(input, init);
    const url = requestUrl(input);
    if (
      (url.includes('/evaluated-signed/') || url.includes('/evaluated-variants-signed/')) &&
      response.ok
    ) {
      body = await response.clone().text();
    }
    return response;
  };
  return { fetch: capturedFetch, body: () => body };
}
