/** Probe the URL builder now, retaining malformed-URL failures until the request. */
export function captureRequestUrl(build: () => string): () => string {
  try {
    void build();
  } catch (error) {
    return () => { throw error; };
  }
  return build;
}
