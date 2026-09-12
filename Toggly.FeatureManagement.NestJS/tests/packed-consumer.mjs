import { createRequire } from 'node:module';
import { verifyCanonicalBoundary } from './canonical-contract.mjs';
// Copy this contract plus fixtures into an isolated npm consumer before running.
const sdk = process.argv.includes('--cjs')
  ? createRequire(import.meta.url)('@ops-ai/toggly-nestjs')
  : await import('@ops-ai/toggly-nestjs');
await verifyCanonicalBoundary(sdk);
console.log(
  JSON.stringify({
    runtime: process.version,
    format: process.argv.includes('--cjs') ? 'cjs' : 'esm',
    canonicalSignature: true,
    requestIsolation: true,
    invalidSignatureRejection: true,
    keyRotation: true,
  }),
);
