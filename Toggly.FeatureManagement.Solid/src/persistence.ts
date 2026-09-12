import {
  parseDefinitionsFromRaw,
  parseSignedEnvelope,
  verifySignedDefinitions,
  type Jwk,
  type JwkSet,
} from '@ops-ai/toggly-signed-defs';
import { selectDefinitions } from './snapshot.js';

export type DefinitionStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface VerificationPolicy {
  allowedKeyIds?: string[];
  maxSignatureAgeSeconds?: number;
}

/** Only the public key which verified this exact envelope is retained. */
export async function verifyEnvelope(
  body: string,
  keys: JwkSet,
  policy: VerificationPolicy,
  minimumTimestamp = 0,
) {
  const { envelope, defsRaw } = parseSignedEnvelope(body);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(envelope.timestamp) || envelope.timestamp < minimumTimestamp || envelope.timestamp > now + 60) {
    throw new Error('Invalid or rolled-back signed timestamp');
  }
  const key = keys.keys.find(candidate => candidate.kid === envelope.kid);
  assertPublicKey(key, now);
  await verifySignedDefinitions(defsRaw, envelope, { keys: [key] }, policy.allowedKeyIds, {
    maxSignatureAgeSeconds: policy.maxSignatureAgeSeconds,
  });
  const definitions = selectDefinitions(parseDefinitionsFromRaw(defsRaw));
  return { definitions, timestamp: envelope.timestamp, keys: { keys: [structuredClone(key)] } };
}

function assertPublicKey(value: unknown, now: number): asserts value is Jwk {
  if (!value || typeof value !== 'object') throw new Error('Missing verification key');
  const key = value as Record<string, unknown>;
  if (key.kty !== 'EC' || key.crv !== 'P-256' || key.alg !== 'ES256' || typeof key.x !== 'string' || typeof key.y !== 'string' || typeof key.kid !== 'string') {
    throw new Error('Invalid verification key');
  }
  if (key.d !== undefined || (key.use !== undefined && key.use !== 'sig')) {
    throw new Error('Verification requires a public signing key');
  }
  if (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || key.key_ops.length !== 1 || key.key_ops[0] !== 'verify')) {
    throw new Error('Invalid verification key operations');
  }
  if (key.exp !== undefined && (!Number.isSafeInteger(key.exp) || (key.exp as number) <= now)) {
    throw new Error('Expired verification key');
  }
}

/**
 * Storage belongs to the application origin and is a local trust boundary.
 * Signatures detect changed envelopes; independently configured key pins also
 * constrain replacement of the stored public key. Whole-store rollback needs
 * external protected monotonic state and is not promised by this cache.
 */
export function createPersistence(storage: DefinitionStorage | undefined, baseURI: string) {
  const trustKey = `toggly:solid:trust:${baseURI.replace(/\/$/, '')}`;
  let unusable = false;

  function generation(create: boolean): string | null {
    if (!storage || unusable) return null;
    const existing = storage.getItem(trustKey);
    if (existing) return existing;
    if (!create) return null;
    const next = crypto.randomUUID();
    storage.setItem(trustKey, next);
    return next;
  }

  return {
    read(scope: string, policy: VerificationPolicy, minimumTimestamp: number) {
      if (!storage || unusable) return;
      try {
        const raw = storage.getItem(`toggly:solid:envelope:${scope}`);
        if (!raw) return;
        const record = JSON.parse(raw);
        const currentGeneration = generation(false);
        if (!currentGeneration || record?.version !== 1 || record.scope !== scope || record.generation !== currentGeneration || typeof record.body !== 'string' || !Array.isArray(record.jwks?.keys)) return;
        return verifyEnvelope(record.body, record.jwks, policy, minimumTimestamp);
      } catch {
        // Corrupt or inaccessible storage cannot block the network path.
        return;
      }
    },
    write(scope: string, body: string, keys: JwkSet) {
      try {
        const currentGeneration = generation(true);
        if (!currentGeneration) return;
        storage!.setItem(`toggly:solid:envelope:${scope}`, JSON.stringify({ version: 1, scope, generation: currentGeneration, body, jwks: keys }));
      } catch {
        // Quota/private-mode failures must not interrupt verified evaluation.
      }
    },
    invalidate() {
      if (!storage || unusable) return;
      try {
        // A new generation retires every historical targeting record at once.
        storage.setItem(trustKey, crypto.randomUUID());
      } catch {
        // If retirement cannot be persisted, never read/write this store again
        // in this session. The application must repair denied storage access.
        unusable = true;
      }
    },
  };
}
