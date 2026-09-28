/** Probe the URL builder now, retaining malformed-URL failures until the request. */
export function captureRequestUrl(build: () => string): () => string {
  try {
    build();
  } catch (error) {
    return () => { throw error; };
  }
  return build;
}
