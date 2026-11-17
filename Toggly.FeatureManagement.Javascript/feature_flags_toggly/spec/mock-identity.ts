/**
 * Deterministic anonymous identity for unit tests.
 * Call from each suite that previously mocked the `uuid` package.
 */
export function mockAnonymousIdentity(value: string): void {
  jest.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
    value as ReturnType<Crypto['randomUUID']>,
  );
}
