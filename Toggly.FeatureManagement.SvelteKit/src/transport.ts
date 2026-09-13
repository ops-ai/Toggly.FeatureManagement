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
    if (requestUrl(input).includes('/evaluated-signed/') && response.ok) {
      body = await response.clone().text();
    }
    return response;
  };
  return { fetch: capturedFetch, body: () => body };
}
