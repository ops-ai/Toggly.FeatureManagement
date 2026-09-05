/**
 * Re-export shared evaluated-signed response helpers.
 */
export {
  readResponseBody,
  parseEvaluatedResponseBody,
  type VerifySignatureOptions,
} from '@ops-ai/toggly-signed-defs'
import { unwrapDefsPayload as unwrapShared } from '@ops-ai/toggly-signed-defs'

/** Reject HTTP 2xx `{ "error": "…" }` envelopes before applying defs. */
function rejectEvaluatedErrorEnvelope(payload: unknown): void {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    (payload as { error?: unknown }).error != null &&
    !(
      'defs' in payload &&
      (payload as { defs?: unknown }).defs
    ) &&
    !(
      'features' in payload &&
      Array.isArray((payload as { features?: unknown }).features)
    )
  ) {
    const message =
      typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : 'error envelope';
    throw new Error(
      `[Toggly] Evaluated-signed response error envelope: ${message}`,
    );
  }
}

/** Unwrap `{ defs }` when present; otherwise treat payload as the defs map. */
export function unwrapDefsPayload(payload: unknown): Record<string, boolean> {
  rejectEvaluatedErrorEnvelope(payload);
  const unwrapped = unwrapShared(payload)
  if (unwrapped && typeof unwrapped === 'object') {
    return unwrapped as Record<string, boolean>
  }
  return {}
}
