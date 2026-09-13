import { it } from 'vitest';
import * as sdk from '../src/index.js';
import { verifyCanonicalBoundary } from './canonical-contract.mjs';
it('accepts independent canonical signatures and preserves request isolation across rejection and key rotation', async () => {
  await verifyCanonicalBoundary(sdk);
}, 10000);
