import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeNugetTrustedPublishing,
  verifyNugetTrustedPublishing,
} from './verify-nuget-trusted-publishing.mjs';
import { REQUIRED_NUGET_SIGN_SECRETS } from './verify-nuget-sourcelink.mjs';

test('sdk-dotnet-release.yml uses NuGet OIDC trusted publishing without API key secret', () => {
  const result = verifyNugetTrustedPublishing();
  assert.equal(
    result.ok,
    true,
    result.errors.length ? result.errors.join('\n') : 'unexpected failure',
  );
});

test('analyzer rejects secrets.NUGET_API_KEY and missing OIDC wiring', () => {
  const bad = `
name: bad
on:
  workflow_dispatch:
permissions:
  contents: write
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - name: Publish to NuGet
        run: |
          dotnet nuget push pkg.nupkg --api-key \${{ secrets.NUGET_API_KEY }}
`;
  const errors = analyzeNugetTrustedPublishing(bad);
  assert.ok(errors.some((e) => /id-token:\s*write/.test(e)));
  assert.ok(errors.some((e) => /NuGet\/login@v1/.test(e)));
  assert.ok(errors.some((e) => /secrets\.NUGET_API_KEY/.test(e)));
  assert.ok(errors.some((e) => /nuget-publish/.test(e)));
  for (const secret of REQUIRED_NUGET_SIGN_SECRETS) {
    assert.ok(errors.some((e) => e.includes(secret)));
  }
});

test('analyzer rejects workflow_call publish path', () => {
  const withCall = `
on:
  workflow_call:
jobs:
  publish:
    environment: nuget-publish
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: NuGet/login@v1
        with:
          user: opsai
`;
  const errors = analyzeNugetTrustedPublishing(withCall);
  assert.ok(errors.some((e) => /workflow_call/.test(e)));
});

test('analyzer rejects NuGet/login user Toggly (package owner, not policy creator)', () => {
  const wrongUser = `
name: wrong-user
on:
  workflow_dispatch:
jobs:
  publish:
    environment: nuget-publish
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: NuGet/login@v1
        with:
          user: Toggly
      - run: echo ok
`;
  const errors = analyzeNugetTrustedPublishing(wrongUser);
  assert.ok(errors.some((e) => /opsai/.test(e)));
  assert.ok(errors.some((e) => /must not be package-owner org Toggly/.test(e)));
});
