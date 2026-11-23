import { expect, it } from 'vitest';
import semver from 'semver';
import pkg from '../package.json';

it('declares SvelteKit 2 and 3 in peerDependencies', () => {
  const range = pkg.peerDependencies['@sveltejs/kit'];
  expect(semver.satisfies('2.70.4', range)).toBe(true);
  expect(semver.satisfies('3.4.0', range)).toBe(true);
});
