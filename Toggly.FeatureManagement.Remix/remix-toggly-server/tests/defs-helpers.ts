/**
 * Helpers to build definitions-signed payloads for server unit tests.
 */

export type SimpleFlags = Record<string, boolean>;

export function featureDefs(flags: SimpleFlags) {
  return Object.entries(flags).map(([featureKey, enabled]) => ({
    featureKey,
    filters: [{ name: enabled ? 'AlwaysOn' : 'AlwaysOff', parameters: {} }],
  }));
}

export function mockDefsFetchResponse(
  flags: SimpleFlags = {},
  extras: Record<string, unknown> = {},
) {
  const defs = featureDefs(flags);
  const body = JSON.stringify(defs);
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(defs),
    headers: { get: () => null },
    ...extras,
  };
}
