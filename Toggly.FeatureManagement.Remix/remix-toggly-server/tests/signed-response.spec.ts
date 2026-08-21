import {
  parseEvaluatedResponseBody,
  readResponseBody,
  unwrapDefsPayload,
} from '../src/signed-response';

describe('signed-response re-exports', () => {
  it('unwraps a defs envelope and leaves a bare map unchanged', () => {
    expect(unwrapDefsPayload({ defs: { feature1: true } })).toEqual({ feature1: true });
    expect(unwrapDefsPayload({ defs: undefined })).toEqual({ defs: undefined });
    expect(unwrapDefsPayload({ feature1: false })).toEqual({ feature1: false });
    expect(unwrapDefsPayload(null)).toBeNull();
  });

  it('reads text() from a response', async () => {
    const text = jest.fn().mockResolvedValue('{"feature1":true}');
    await expect(readResponseBody({ text } as unknown as Response)).resolves.toBe(
      '{"feature1":true}',
    );
  });

  it('parses unsigned JSON bodies', async () => {
    await expect(
      parseEvaluatedResponseBody('{"defs":{"feature1":true}}', {}),
    ).resolves.toEqual({ defs: { feature1: true } });
  });
});
