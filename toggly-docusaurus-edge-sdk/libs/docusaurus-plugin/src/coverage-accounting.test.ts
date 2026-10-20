import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { verifyCoverageAccounting } from '../../core/tests/support/coverage-accounting';

it('counts unimported TSX source and rejects coverage below the package floor', () => {
  verifyCoverageAccounting(fileURLToPath(new URL('..', import.meta.url)), 'tsx');
}, 35000);
