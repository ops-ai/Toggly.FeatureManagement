import {
  toBooleanDefinitions,
  type EvaluatedDefinitions,
} from '@ops-ai/toggly-hooks-types';
import type { Flags } from './toggly-client.js';

/** Flatten evaluated-signed defs (booleans or entity gates) to a boolean map. */
export function normalizeEvaluatedFlags(raw: unknown): Flags {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  return toBooleanDefinitions(raw as EvaluatedDefinitions);
}
