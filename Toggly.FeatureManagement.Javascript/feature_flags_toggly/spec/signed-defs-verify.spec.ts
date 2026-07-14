import { createHash, generateKeyPairSync, sign, webcrypto } from 'crypto';

// Jest may not expose Web Crypto; Node's webcrypto matches production browsers.
if (!(globalThis as any).crypto?.subtle) {
  (globalThis as any).crypto = webcrypto as any;
}

import {
  base64ToBytes,
  computeKid,
  derSignatureToP1363,
  extractRawJsonProperty,
  parseDefinitionsFromRaw,
  parseSignedEnvelope,
  verifySignedDefinitions,
} from '../lib/signed-defs-verify';

function computeKidSync(x, y) {
  const xBytes = Buffer.from(x, 'base64url');
  const yBytes = Buffer.from(y, 'base64url');
  const digest = createHash('sha1').update(xBytes).update(yBytes).digest('hex').toUpperCase();
  return `${digest}ES256`;
}

function doubleSha256(payload) {
  const first = createHash('sha256').update(payload, 'utf8').digest();
  return createHash('sha256').update(first).digest();
}

function makeSignedKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwkExport = publicKey.export({ format: 'jwk' });
  const kid = computeKidSync(jwkExport.x, jwkExport.y);
  return {
    privateKey,
    jwk: {
      kty: 'EC',
      use: 'sig',
      alg: 'ES256',
      crv: 'P-256',
      x: jwkExport.x,
      y: jwkExport.y,
      kid,
    },
  };
}

function signP1363(privateKey, hash) {
  return sign(null, hash, { key: privateKey, dsaEncoding: 'ieee-p1363' });
}

function signDer(privateKey, hash) {
  return sign(null, hash, { key: privateKey, dsaEncoding: 'der' });
}

describe('signed-defs-verify', () => {
  it('extracts exact top-level defs bytes', () => {
    const body = '{"defs":{"a":1},"signature":"x","timestamp":1,"kid":"k"}';
    expect(extractRawJsonProperty(body, 'defs')).toBe('{"a":1}');
  });

  it('ignores nested defs under data', () => {
    const body =
      '{"data":{"defs":{"innocent":true}},"defs":{"Evil":true},"signature":"x","timestamp":1,"kid":"k"}';
    expect(extractRawJsonProperty(body, 'defs')).toBe('{"Evil":true}');
  });

  it('extracts string, array, number, boolean, and null top-level values', () => {
    expect(extractRawJsonProperty('{"defs":"x","signature":"s","timestamp":1,"kid":"k"}', 'defs')).toBe(
      '"x"'
    );
    expect(extractRawJsonProperty('{"defs":[1,2],"signature":"s","timestamp":1,"kid":"k"}', 'defs')).toBe(
      '[1,2]'
    );
    expect(extractRawJsonProperty('{"defs":42,"signature":"s","timestamp":1,"kid":"k"}', 'defs')).toBe(
      '42'
    );
    expect(
      extractRawJsonProperty('{"defs":true,"signature":"s","timestamp":1,"kid":"k"}', 'defs')
    ).toBe('true');
    expect(
      extractRawJsonProperty('{"defs":null,"signature":"s","timestamp":1,"kid":"k"}', 'defs')
    ).toBe('null');
  });

  it('handles escaped quotes inside property names and string values', () => {
    expect(
      extractRawJsonProperty('{"de\\"fs":1,"defs":{"ok":true},"signature":"s","timestamp":1,"kid":"k"}', 'defs')
    ).toBe('{"ok":true}');
    expect(
      extractRawJsonProperty('{"defs":"a\\"b","signature":"s","timestamp":1,"kid":"k"}', 'defs')
    ).toBe('"a\\"b"');
  });

  it('returns null for missing keys and malformed values', () => {
    expect(extractRawJsonProperty('{"signature":"s","timestamp":1,"kid":"k"}', 'defs')).toBeNull();
    expect(extractRawJsonProperty('{"defs":{"a":1', 'defs')).toBeNull();
    expect(extractRawJsonProperty('{"defs":"unterminated', 'defs')).toBeNull();
  });

  it('accepts Web Crypto double-SHA256 signatures over raw defs', async () => {
    const { privateKey, jwk } = makeSignedKey();
    const jwks = { keys: [jwk] };
    const defs = '{"PresalePhotos":true,"PuppySales":false}';
    const timestamp = 1783915396;
    const signature = signP1363(privateKey, doubleSha256(`${defs}|${timestamp}`)).toString('base64');

    await expect(
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, jwks)
    ).resolves.toBeUndefined();
  });

  it('treats empty allowedKids as unrestricted', async () => {
    const { privateKey, jwk } = makeSignedKey();
    const defs = '{"a":1}';
    const timestamp = 3;
    const signature = signP1363(privateKey, doubleSha256(`${defs}|${timestamp}`)).toString('base64');
    await expect(
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, { keys: [jwk] }, [])
    ).resolves.toBeUndefined();
  });

  it('accepts URL-safe base64 signatures', async () => {
    const { privateKey, jwk } = makeSignedKey();
    const jwks = { keys: [jwk] };
    const defs = '{"a":1}';
    const timestamp = 7;
    const signature = signP1363(privateKey, doubleSha256(`${defs}|${timestamp}`))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await expect(
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, jwks)
    ).resolves.toBeUndefined();
  });

  it('accepts DER signatures (Key Vault style)', async () => {
    const { privateKey, jwk } = makeSignedKey();
    const jwks = { keys: [jwk] };
    const defs = '{"PresalePhotos":true}';
    const timestamp = 1783915396;
    const signature = signDer(privateKey, doubleSha256(`${defs}|${timestamp}`)).toString('base64');

    await expect(
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, jwks)
    ).resolves.toBeUndefined();
  });

  it('rejects single-SHA256 signatures', async () => {
    const { privateKey, jwk } = makeSignedKey();
    const jwks = { keys: [jwk] };
    const defs = '{"PresalePhotos":true}';
    const timestamp = 1783915396;
    const singleHash = createHash('sha256').update(`${defs}|${timestamp}`, 'utf8').digest();
    const signature = signP1363(privateKey, singleHash).toString('base64');

    await expect(
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, jwks)
    ).rejects.toThrow(/invalid signature/);
  });

  it('parseSignedEnvelope keeps raw defs for verify and apply', async () => {
    const { privateKey, jwk } = makeSignedKey();
    const jwks = { keys: [jwk] };
    const defs = '{"feature-a":true}';
    const timestamp = 42;
    const signature = signP1363(privateKey, doubleSha256(`${defs}|${timestamp}`)).toString('base64');
    const body = `{"defs":${defs},"signature":"${signature}","timestamp":${timestamp},"kid":"${jwk.kid}"}`;

    const { envelope, defsRaw } = parseSignedEnvelope(body);
    expect(defsRaw).toBe(defs);
    await verifySignedDefinitions(defsRaw, envelope, jwks);
    expect(parseDefinitionsFromRaw(defsRaw)).toEqual({ 'feature-a': true });
  });

  it('falls back to top-level data when defs is absent', () => {
    const body = '{"data":{"feature-a":true},"signature":"sig","timestamp":1,"kid":"kid"}';
    const { defsRaw } = parseSignedEnvelope(body);
    expect(defsRaw).toBe('{"feature-a":true}');
  });

  it('rejects envelopes missing defs/data payload', () => {
    expect(() =>
      parseSignedEnvelope('{"signature":"sig","timestamp":1,"kid":"kid"}')
    ).toThrow(/Signed envelope missing defs/);
  });

  it('nested innocent defs cannot authenticate unsigned outer defs', async () => {
    const { privateKey, jwk } = makeSignedKey();
    const jwks = { keys: [jwk] };
    const innocent = '{"innocent":true}';
    const evil = '{"Evil":true}';
    const timestamp = 99;
    // Signature covers nested/innocent bytes only.
    const signature = signP1363(
      privateKey,
      doubleSha256(`${innocent}|${timestamp}`)
    ).toString('base64');
    const body =
      `{"data":{"defs":${innocent}},"defs":${evil},"signature":"${signature}","timestamp":${timestamp},"kid":"${jwk.kid}"}`;

    const { envelope, defsRaw } = parseSignedEnvelope(body);
    expect(defsRaw).toBe(evil);
    await expect(
      verifySignedDefinitions(defsRaw, envelope, jwks)
    ).rejects.toThrow(/invalid signature/);
    // Callers must apply defsRaw after verify — never envelope.defs from a forged body alone.
    expect(parseDefinitionsFromRaw(defsRaw)).toEqual({ Evil: true });
  });

  it('rejects empty signature or kid in the envelope', () => {
    expect(() =>
      parseSignedEnvelope('{"defs":{"a":1},"signature":"","timestamp":1,"kid":"k"}')
    ).toThrow(/Invalid signed definitions envelope/);
    expect(() =>
      parseSignedEnvelope('{"defs":{"a":1},"signature":"x","timestamp":1,"kid":""}')
    ).toThrow(/Invalid signed definitions envelope/);
    expect(() =>
      parseSignedEnvelope('{"defs":{"a":1},"signature":"x","timestamp":"1","kid":"k"}')
    ).toThrow(/Invalid signed definitions envelope/);
  });

  it('rejects disallowed kids, missing keys, and bad key material', async () => {
    const { privateKey, jwk } = makeSignedKey();
    const defs = '{"a":1}';
    const timestamp = 1;
    const signature = signP1363(privateKey, doubleSha256(`${defs}|${timestamp}`)).toString('base64');

    await expect(
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, { keys: [jwk] }, [
        'other-kid',
      ])
    ).rejects.toThrow(/kid not allowed/);

    await expect(
      verifySignedDefinitions(defs, { signature, timestamp, kid: 'missing' }, { keys: [jwk] })
    ).rejects.toThrow(/no matching jwk/);

    await expect(
      verifySignedDefinitions(
        defs,
        { signature, timestamp, kid: jwk.kid },
        { keys: [{ ...jwk, alg: 'RS256' }] }
      )
    ).rejects.toThrow(/unsupported alg/);

    await expect(
      verifySignedDefinitions(
        defs,
        { signature, timestamp, kid: jwk.kid },
        { keys: [{ ...jwk, crv: 'P-384' }] }
      )
    ).rejects.toThrow(/unsupported crv/);

    await expect(
      verifySignedDefinitions(
        defs,
        { signature, timestamp, kid: jwk.kid },
        { keys: [{ ...jwk, alg: undefined as any }] }
      )
    ).rejects.toThrow(/unsupported alg/);

    await expect(
      verifySignedDefinitions(
        defs,
        { signature, timestamp, kid: jwk.kid },
        { keys: [{ ...jwk, x: undefined as any }] }
      )
    ).rejects.toThrow(/missing x or y/);

    await expect(
      verifySignedDefinitions(
        defs,
        { signature, timestamp, kid: 'WRONGES256' },
        { keys: [{ ...jwk, kid: 'WRONGES256' }] }
      )
    ).rejects.toThrow(/invalid kid/);
  });

  it('computeKid matches production kid format', async () => {
    const { jwk } = makeSignedKey();
    await expect(computeKid(jwk.x, jwk.y)).resolves.toBe(jwk.kid);
  });

  it('base64ToBytes decodes standard and url-safe input', () => {
    expect(Buffer.from(base64ToBytes('YQ==')).toString('utf8')).toBe('a');
    expect(Buffer.from(base64ToBytes('YQ')).toString('utf8')).toBe('a');
    expect(Buffer.from(base64ToBytes('-_8')).length).toBe(2);
  });

  it('converts DER signatures to P1363 for WebCrypto', () => {
    const { privateKey } = makeSignedKey();
    const hash = doubleSha256('{"a":1}|1');
    const p1363 = derSignatureToP1363(Uint8Array.from(signDer(privateKey, hash)));
    expect(p1363.length).toBe(64);
  });

  it('rejects invalid DER signatures', () => {
    expect(() => derSignatureToP1363(Uint8Array.from([1, 2, 3]))).toThrow(/invalid DER/);
    expect(() => derSignatureToP1363(Uint8Array.from([0x30, 0x01, 0x00]))).toThrow();
    expect(() =>
      derSignatureToP1363(
        Uint8Array.from([0x30, 0x06, 0x03, 0x01, 0x01, 0x02, 0x01, 0x01])
      )
    ).toThrow(/invalid DER integer/);
    // Long-form length prefix (0x81) with truncated body
    expect(() =>
      derSignatureToP1363(Uint8Array.from([0x30, 0x81, 0x40, 0x02, 0x01, 0x01]))
    ).toThrow();
  });

  it('tolerates whitespace around top-level property colons', () => {
    expect(
      extractRawJsonProperty(
        '{"defs"  :  {"a":1},"signature":"s","timestamp":1,"kid":"k"}',
        'defs'
      )
    ).toBe('{"a":1}');
  });

  describe('WebCrypto verify path', () => {
    const originalNode = process.versions.node;
    let verifySpy: jest.SpyInstance;
    let importKeySpy: jest.SpyInstance;
    let digestSpy: jest.SpyInstance;

    beforeAll(() => {
      Object.defineProperty(process.versions, 'node', {
        value: undefined,
        configurable: true,
        enumerable: true,
        writable: true,
      });
      // jsdom/React often expose a non-configurable crypto stub without subtle.
      Object.defineProperty(globalThis, 'crypto', {
        value: webcrypto,
        configurable: true,
        writable: true,
      });
    });

    afterAll(() => {
      Object.defineProperty(process.versions, 'node', {
        value: originalNode,
        configurable: true,
        enumerable: true,
        writable: true,
      });
    });

    beforeEach(() => {
      // Node's SubtleCrypto does not re-hash like browsers; mock the browser contract.
      const subtle = globalThis.crypto.subtle;
      digestSpy = jest.spyOn(subtle, 'digest').mockImplementation(async (algorithm, data) => {
        const name =
          typeof algorithm === 'string' ? algorithm : (algorithm as Algorithm).name;
        const hashName = name.replace('-', '').toLowerCase(); // SHA-256 → sha256
        return createHash(hashName).update(Buffer.from(data as ArrayBuffer)).digest();
      });
      importKeySpy = jest.spyOn(subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      verifySpy = jest.spyOn(subtle, 'verify').mockResolvedValue(true);
    });

    afterEach(() => {
      digestSpy?.mockRestore();
      importKeySpy?.mockRestore();
      verifySpy?.mockRestore();
    });

    it('passes first SHA-256 digest into subtle.verify (browser double-hash)', async () => {
      const { jwk } = makeSignedKey();
      const defs = '{"web":true}';
      const timestamp = 55;
      const signature = Buffer.alloc(64, 7).toString('base64');

      await verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, { keys: [jwk] });

      expect(importKeySpy).toHaveBeenCalled();
      expect(verifySpy).toHaveBeenCalled();
      const dataArg = verifySpy.mock.calls[0][3] as BufferSource;
      const dataBytes = new Uint8Array(dataArg as ArrayBuffer);
      expect(dataBytes.length).toBe(32);
      const expectedFirst = createHash('sha256').update(`${defs}|${timestamp}`, 'utf8').digest();
      expect(Buffer.from(dataBytes)).toEqual(expectedFirst);
    });

    it('converts DER signatures to P1363 before subtle.verify', async () => {
      const { privateKey, jwk } = makeSignedKey();
      const defs = '{"web":true}';
      const timestamp = 56;
      const der = signDer(privateKey, doubleSha256(`${defs}|${timestamp}`));
      const signature = der.toString('base64');

      await verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, { keys: [jwk] });

      const sigArg = new Uint8Array(verifySpy.mock.calls[0][2] as ArrayBuffer);
      expect(sigArg.length).toBe(64);
    });

    it('rejects when subtle.verify returns false', async () => {
      verifySpy.mockResolvedValue(false);
      const { jwk } = makeSignedKey();
      const signature = Buffer.alloc(64, 1).toString('base64');

      await expect(
        verifySignedDefinitions(
          '{"web":true}',
          { signature, timestamp: 57, kid: jwk.kid },
          { keys: [jwk] }
        )
      ).rejects.toThrow(/invalid signature/);
    });

    it('computeKid works via subtle SHA-1', async () => {
      const { jwk } = makeSignedKey();
      await expect(computeKid(jwk.x, jwk.y)).resolves.toBe(jwk.kid);
      expect(digestSpy).toHaveBeenCalled();
    });
  });

  it('throws when WebCrypto is unavailable outside Node', async () => {
    const originalNode = process.versions.node;
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(process.versions, 'node', {
      value: undefined,
      configurable: true,
      enumerable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
    });
    try {
      const { jwk } = makeSignedKey();
      await expect(
        verifySignedDefinitions(
          '{"a":1}',
          { signature: Buffer.alloc(64).toString('base64'), timestamp: 1, kid: jwk.kid },
          { keys: [jwk] }
        )
      ).rejects.toThrow(/WebCrypto is required/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        configurable: true,
      });
      Object.defineProperty(process.versions, 'node', {
        value: originalNode,
        configurable: true,
        enumerable: true,
        writable: true,
      });
    }
  });

  it('decodes base64 via atob when Buffer is unavailable', () => {
    const originalBuffer = globalThis.Buffer;
    Object.defineProperty(globalThis, 'Buffer', {
      value: undefined,
      configurable: true,
    });
    try {
      if (typeof atob !== 'function') {
        (globalThis as any).atob = (value: string) =>
          originalBuffer.from(value, 'base64').toString('binary');
      }
      const bytes = base64ToBytes('YWI=');
      expect(Array.from(bytes)).toEqual([97, 98]);
    } finally {
      Object.defineProperty(globalThis, 'Buffer', {
        value: originalBuffer,
        configurable: true,
      });
    }
  });

  it('rejects when atob is unavailable and Buffer is missing', () => {
    const originalBuffer = globalThis.Buffer;
    const originalAtob = globalThis.atob;
    Object.defineProperty(globalThis, 'Buffer', {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'atob', {
      value: undefined,
      configurable: true,
    });
    try {
      expect(() => base64ToBytes('YQ==')).toThrow(/base64 decoding is not available/);
    } finally {
      Object.defineProperty(globalThis, 'Buffer', {
        value: originalBuffer,
        configurable: true,
      });
      Object.defineProperty(globalThis, 'atob', {
        value: originalAtob,
        configurable: true,
      });
    }
  });
});
