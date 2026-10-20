import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { verifyCoverageAccounting } from '../tests/support/coverage-accounting';

it('counts unimported executable source and rejects coverage below the package floor', () => {
  verifyCoverageAccounting(fileURLToPath(new URL('..', import.meta.url)), 'ts');
}, 35000);
