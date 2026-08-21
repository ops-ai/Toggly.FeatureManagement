/**
 * Re-export shared evaluated-signed response helpers.
 */
export {
  readResponseBody,
  parseEvaluatedResponseBody,
  type VerifySignatureOptions,
} from '@ops-ai/toggly-signed-defs'
import { unwrapDefsPayload as unwrapShared } from '@ops-ai/toggly-signed-defs'

/** Unwrap `{ defs }` when present; otherwise treat payload as the defs map. */
export function unwrapDefsPayload(payload: unknown): Record<string, boolean> {
  const unwrapped = unwrapShared(payload)
  if (unwrapped && typeof unwrapped === 'object') {
    return unwrapped as Record<string, boolean>
  }
  return {}
}
