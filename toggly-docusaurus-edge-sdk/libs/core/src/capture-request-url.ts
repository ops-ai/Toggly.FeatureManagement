/** Capture a request URL now, retaining malformed-URL failures until the request. */
export function captureRequestUrl(build: () => string): () => string {
  try {
    const url = build();
    return () => url;
  } catch (error) {
    return () => { throw error; };
  }
}
