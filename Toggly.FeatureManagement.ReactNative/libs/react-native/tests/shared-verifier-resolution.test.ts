import { createRequire } from 'node:module';
import { join } from 'node:path';

const requireFromPackage = createRequire(join(__dirname, '..', 'package.json'));

describe('clean React Native test host', () => {
  it('resolves the shared signed-definitions verifier from the package root', () => {
    expect(requireFromPackage.resolve('@ops-ai/toggly-signed-defs')).toMatch(
      /toggly-signed-defs[\\/]dist[\\/]/
    );
  });
});
