import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_NUGET_SIGN_SECRETS,
  verifyDirectoryBuildSourceLink,
  verifyDualPackHashes,
  verifyPackableProjectsInheritSourceLink,
  verifyPackedSymbols,
  verifySigningWorkflow,
} from './verify-nuget-sourcelink.mjs';

test('Directory.Build.props centralizes deterministic + SourceLink properties', () => {
  const result = verifyDirectoryBuildSourceLink();
  assert.equal(
    result.ok,
    true,
    result.errors?.length ? result.errors.join('\n') : 'unexpected failure',
  );
});

test('all eleven packable projects inherit SourceLink (no per-csproj duplicates)', () => {
  const result = verifyPackableProjectsInheritSourceLink();
  assert.equal(
    result.ok,
    true,
    result.errors?.length ? result.errors.join('\n') : 'unexpected failure',
  );
});

test('sdk-dotnet-release.yml signs nupkg and snupkg and keeps NUGET_SIGN_* secrets', () => {
  const result = verifySigningWorkflow();
  assert.equal(
    result.ok,
    true,
    result.errors?.length ? result.errors.join('\n') : 'unexpected failure',
  );
  for (const secret of REQUIRED_NUGET_SIGN_SECRETS) {
    assert.ok(secret.startsWith('NUGET_SIGN_'));
  }
});

test('packed symbols contract runs when NUGET_PACK_DIR is set', () => {
  if (!process.env.NUGET_PACK_DIR) {
    assert.equal(verifyPackedSymbols().skipped, true);
    return;
  }
  const result = verifyPackedSymbols();
  assert.equal(
    result.ok,
    true,
    result.errors?.length ? result.errors.join('\n') : 'unexpected pack failure',
  );
});

test('unsigned dual-pack hash check runs when RUN_NUGET_DUAL_PACK=1', () => {
  if (process.env.RUN_NUGET_DUAL_PACK !== '1') {
    const skipped = verifyDualPackHashes();
    assert.equal(skipped.skipped, true);
    assert.match(skipped.note, /RepositoryCommit|OPC|RFC3161/i);
    return;
  }
  const result = verifyDualPackHashes({ force: true });
  assert.equal(
    result.ok,
    true,
    result.errors?.length ? result.errors.join('\n') : 'dual-pack failure',
  );
});
