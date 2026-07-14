import {
  base64ToBytes,
  computeKid,
  derSignatureToP1363,
  extractRawJsonProperty,
  parseDefinitionsFromRaw,
  parseSignedEnvelope,
  verifySignedDefinitions,
} from './signed-defs-verify';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function p1363ToDer(signature: Uint8Array): Uint8Array {
  const encodeInteger = (value: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) {
      start++;
    }
    let trimmed = value.slice(start);
    if (trimmed[0]! >= 0x80) {
      const prefixed = new Uint8Array(trimmed.length + 1);
      prefixed.set(trimmed, 1);
      trimmed = prefixed;
    }
    const out = new Uint8Array(2 + trimmed.length);
    out[0] = 0x02;
    out[1] = trimmed.length;
    out.set(trimmed, 2);
    return out;
  };

  const r = encodeInteger(signature.slice(0, 32));
  const s = encodeInteger(signature.slice(32, 64));
  const body = new Uint8Array(r.length + s.length);
  body.set(r, 0);
  body.set(s, r.length);
  const out = new Uint8Array(2 + body.length);
  out[0] = 0x30;
  out[1] = body.length;
  out.set(body, 2);
  return out;
}

async function makeSignedKey() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const jwkExport = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as {
    x?: string;
    y?: string;
  };
  const kid = await computeKid(jwkExport.x!, jwkExport.y!);
  return {
    privateKey: keyPair.privateKey,
    jwk: {
      kty: 'EC',
      use: 'sig',
      alg: 'ES256',
      crv: 'P-256',
      x: jwkExport.x!,
      y: jwkExport.y!,
      kid,
    },
  };
}

async function signDoubleHashP1363(
  privateKey: CryptoKey,
  defs: string,
  timestamp: number
): Promise<Uint8Array> {
  const payload = new TextEncoder().encode(`${defs}|${timestamp}`);
  const firstDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
  // subtle.sign hashes again → effective double SHA-256, matching verify path.
  return new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, firstDigest)
  );
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
      extractRawJsonProperty(
        '{"de\\"fs":1,"defs":{"ok":true},"signature":"s","timestamp":1,"kid":"k"}',
        'defs'
      )
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
    const { privateKey, jwk } = await makeSignedKey();
    const defs = '{"PresalePhotos":true,"PuppySales":false}';
    const timestamp = 1783915396;
    const signature = bytesToBase64(await signDoubleHashP1363(privateKey, defs, timestamp));

    await expectAsync(
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, { keys: [jwk] })
    ).toBeResolved();
  });

  it('treats empty allowedKids as unrestricted', async () => {
    const { privateKey, jwk } = await makeSignedKey();
    const defs = '{"a":1}';
    const timestamp = 3;
    const signature = bytesToBase64(await signDoubleHashP1363(privateKey, defs, timestamp));
    await expectAsync(
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, { keys: [jwk] }, [])
    ).toBeResolved();
  });

  it('accepts URL-safe base64 signatures', async () => {
    const { privateKey, jwk } = await makeSignedKey();
    const defs = '{"a":1}';
    const timestamp = 7;
    const signature = bytesToBase64Url(await signDoubleHashP1363(privateKey, defs, timestamp));

    await expectAsync(
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, { keys: [jwk] })
    ).toBeResolved();
  });

  it('accepts DER signatures (Key Vault style)', async () => {
    const { privateKey, jwk } = await makeSignedKey();
    const defs = '{"PresalePhotos":true}';
    const timestamp = 1783915396;
    const p1363 = await signDoubleHashP1363(privateKey, defs, timestamp);
    const signature = bytesToBase64(p1363ToDer(p1363));

    await expectAsync(
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, { keys: [jwk] })
    ).toBeResolved();
  });

  it('rejects single-SHA256 signatures', async () => {
    const { privateKey, jwk } = await makeSignedKey();
    const defs = '{"PresalePhotos":true}';
    const timestamp = 1783915396;
    const payload = new TextEncoder().encode(`${defs}|${timestamp}`);
    // Sign the raw payload (subtle hashes once) → single-hash signature.
    const signature = bytesToBase64(
      new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, payload)
      )
    );

    await expectAsync(
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, { keys: [jwk] })
    ).toBeRejectedWithError(/invalid signature/);
  });

  it('parseSignedEnvelope keeps raw defs for verify and apply', async () => {
    const { privateKey, jwk } = await makeSignedKey();
    const defs = '{"feature-a":true}';
    const timestamp = 42;
    const signature = bytesToBase64(await signDoubleHashP1363(privateKey, defs, timestamp));
    const body = `{"defs":${defs},"signature":"${signature}","timestamp":${timestamp},"kid":"${jwk.kid}"}`;

    const { envelope, defsRaw } = parseSignedEnvelope(body);
    expect(defsRaw).toBe(defs);
    await verifySignedDefinitions(defsRaw, envelope, { keys: [jwk] });
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
    ).toThrowError(/Signed envelope missing defs/);
  });

  it('nested innocent defs cannot authenticate unsigned outer defs', async () => {
    const { privateKey, jwk } = await makeSignedKey();
    const innocent = '{"innocent":true}';
    const evil = '{"Evil":true}';
    const timestamp = 99;
    const signature = bytesToBase64(await signDoubleHashP1363(privateKey, innocent, timestamp));
    const body =
      `{"data":{"defs":${innocent}},"defs":${evil},"signature":"${signature}","timestamp":${timestamp},"kid":"${jwk.kid}"}`;

    const { envelope, defsRaw } = parseSignedEnvelope(body);
    expect(defsRaw).toBe(evil);
    await expectAsync(
      verifySignedDefinitions(defsRaw, envelope, { keys: [jwk] })
    ).toBeRejectedWithError(/invalid signature/);
    expect(parseDefinitionsFromRaw(defsRaw)).toEqual({ Evil: true });
  });

  it('rejects empty signature or kid in the envelope', () => {
    expect(() =>
      parseSignedEnvelope('{"defs":{"a":1},"signature":"","timestamp":1,"kid":"k"}')
    ).toThrowError(/Invalid signed definitions envelope/);
    expect(() =>
      parseSignedEnvelope('{"defs":{"a":1},"signature":"x","timestamp":1,"kid":""}')
    ).toThrowError(/Invalid signed definitions envelope/);
    expect(() =>
      parseSignedEnvelope('{"defs":{"a":1},"signature":"x","timestamp":"1","kid":"k"}')
    ).toThrowError(/Invalid signed definitions envelope/);
  });

  it('rejects disallowed kids, missing keys, and bad key material', async () => {
    const { privateKey, jwk } = await makeSignedKey();
    const defs = '{"a":1}';
    const timestamp = 1;
    const signature = bytesToBase64(await signDoubleHashP1363(privateKey, defs, timestamp));

    await expectAsync(
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, { keys: [jwk] }, [
        'other-kid',
      ])
    ).toBeRejectedWithError(/kid not allowed/);

    await expectAsync(
      verifySignedDefinitions(defs, { signature, timestamp, kid: 'missing' }, { keys: [jwk] })
    ).toBeRejectedWithError(/no matching jwk/);

    await expectAsync(
      verifySignedDefinitions(
        defs,
        { signature, timestamp, kid: jwk.kid },
        { keys: [{ ...jwk, alg: 'RS256' }] }
      )
    ).toBeRejectedWithError(/unsupported alg/);

    await expectAsync(
      verifySignedDefinitions(
        defs,
        { signature, timestamp, kid: jwk.kid },
        { keys: [{ ...jwk, crv: 'P-384' }] }
      )
    ).toBeRejectedWithError(/unsupported crv/);

    await expectAsync(
      verifySignedDefinitions(
        defs,
        { signature, timestamp, kid: jwk.kid },
        { keys: [{ ...jwk, x: undefined as unknown as string }] }
      )
    ).toBeRejectedWithError(/missing x or y/);

    await expectAsync(
      verifySignedDefinitions(
        defs,
        { signature, timestamp, kid: 'WRONGES256' },
        { keys: [{ ...jwk, kid: 'WRONGES256' }] }
      )
    ).toBeRejectedWithError(/invalid kid/);
  });

  it('computeKid matches production kid format', async () => {
    const { jwk } = await makeSignedKey();
    await expectAsync(computeKid(jwk.x, jwk.y)).toBeResolvedTo(jwk.kid);
  });

  it('base64ToBytes decodes standard and url-safe input', () => {
    expect(new TextDecoder().decode(base64ToBytes('YQ=='))).toBe('a');
    expect(new TextDecoder().decode(base64ToBytes('YQ'))).toBe('a');
    expect(base64ToBytes('-_8').length).toBe(2);
  });

  it('converts DER signatures to P1363 for WebCrypto', async () => {
    const { privateKey } = await makeSignedKey();
    const p1363 = await signDoubleHashP1363(privateKey, '{"a":1}', 1);
    const converted = derSignatureToP1363(p1363ToDer(p1363));
    expect(converted.length).toBe(64);
  });

  it('accepts long-form DER length prefixes', async () => {
    const { privateKey } = await makeSignedKey();
    const p1363 = await signDoubleHashP1363(privateKey, '{"a":1}', 1);
    const shortDer = p1363ToDer(p1363);
    const longDer = new Uint8Array(shortDer.length + 1);
    longDer[0] = 0x30;
    longDer[1] = 0x81;
    longDer[2] = shortDer[1]!;
    longDer.set(shortDer.slice(2), 3);
    expect(derSignatureToP1363(longDer).length).toBe(64);
  });

  it('rejects invalid DER signatures', () => {
    expect(() => derSignatureToP1363(Uint8Array.from([1, 2, 3]))).toThrowError(/invalid DER/);
    expect(() => derSignatureToP1363(Uint8Array.from([0x30, 0x01, 0x00]))).toThrowError();
    expect(() =>
      derSignatureToP1363(Uint8Array.from([0x30, 0x06, 0x03, 0x01, 0x01, 0x02, 0x01, 0x01]))
    ).toThrowError(/invalid DER integer/);
    expect(() =>
      derSignatureToP1363(Uint8Array.from([0x30, 0x81, 0x40, 0x02, 0x01, 0x01]))
    ).toThrowError();
  });

  it('tolerates whitespace around top-level property colons', () => {
    expect(
      extractRawJsonProperty(
        '{"defs"  :  {"a":1},"signature":"s","timestamp":1,"kid":"k"}',
        'defs'
      )
    ).toBe('{"a":1}');
  });

  it('throws when WebCrypto is unavailable', async () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
    });
    try {
      await expectAsync(computeKid('AA', 'AA')).toBeRejectedWithError(/WebCrypto is required/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        configurable: true,
      });
    }
  });

  it('decodes base64 via atob when Buffer is unavailable', () => {
    const g = globalThis as unknown as { Buffer?: unknown; atob: typeof atob };
    const originalBuffer = g.Buffer;
    Object.defineProperty(globalThis, 'Buffer', {
      value: undefined,
      configurable: true,
    });
    try {
      const bytes = base64ToBytes('YWI=');
      expect(Array.from(bytes)).toEqual([97, 98]);
    } finally {
      Object.defineProperty(globalThis, 'Buffer', {
        value: originalBuffer,
        configurable: true,
      });
    }
  });

  it('decodes base64 via Buffer when present', () => {
    const g = globalThis as unknown as { Buffer?: unknown };
    const originalBuffer = g.Buffer;
    Object.defineProperty(globalThis, 'Buffer', {
      value: {
        from(value: string, encoding: string): Uint8Array {
          expect(encoding).toBe('base64');
          const binary = atob(value);
          const out = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            out[i] = binary.charCodeAt(i);
          }
          return out;
        },
      },
      configurable: true,
    });
    try {
      expect(Array.from(base64ToBytes('YWI='))).toEqual([97, 98]);
    } finally {
      Object.defineProperty(globalThis, 'Buffer', {
        value: originalBuffer,
        configurable: true,
      });
    }
  });

  it('handles escaped characters while scanning JSON values', () => {
    expect(
      extractRawJsonProperty(
        '{"defs":{"path":"a\\\\b\\"c"},"signature":"s","timestamp":1,"kid":"k"}',
        'defs'
      )
    ).toBe('{"path":"a\\\\b\\"c"}');
  });

  it('throws when WebCrypto subtle is missing during verify', async () => {
    const { privateKey, jwk } = await makeSignedKey();
    const defs = '{"a":1}';
    const timestamp = 9;
    const signature = bytesToBase64(await signDoubleHashP1363(privateKey, defs, timestamp));
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      value: {},
      configurable: true,
    });
    try {
      await expectAsync(
        verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, { keys: [jwk] })
      ).toBeRejectedWithError(/WebCrypto is required/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        configurable: true,
      });
    }
  });

  it('rejects when atob is unavailable and Buffer is missing', () => {
    const g = globalThis as unknown as { Buffer?: unknown; atob?: typeof atob };
    const originalBuffer = g.Buffer;
    const originalAtob = g.atob;
    Object.defineProperty(globalThis, 'Buffer', {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'atob', {
      value: undefined,
      configurable: true,
    });
    try {
      expect(() => base64ToBytes('YQ==')).toThrowError(/base64 decoding is not available/);
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

  it('rejects when subtle.verify returns false', async () => {
    const { jwk } = await makeSignedKey();
    const signature = bytesToBase64(new Uint8Array(64));
    await expectAsync(
      verifySignedDefinitions(
        '{"web":true}',
        { signature, timestamp: 57, kid: jwk.kid },
        { keys: [jwk] }
      )
    ).toBeRejectedWithError(/invalid signature/);
  });
});
