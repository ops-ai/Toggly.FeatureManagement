export function createMockFetchResponse(
  body: unknown,
  status = 200,
  statusText = status === 200 ? 'OK' : 'Error',
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
  };
}
