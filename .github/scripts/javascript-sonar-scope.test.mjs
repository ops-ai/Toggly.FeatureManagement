import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveJavaScriptSonarScope, SDK_SCOPES } from './javascript-sonar-scope.mjs';

test('aggregate scope keeps the shared JavaScript Sonar project', () => {
  const scope = resolveJavaScriptSonarScope('all');
  assert.equal(scope.scoped, false);
  assert.equal(scope.projectKey, 'toggly-sdks-javascript');
  assert.ok(scope.sources.includes('Toggly.FeatureManagement.React'));
  assert.ok(scope.sources.includes('toggly-signed-defs/src'));
  assert.equal(scope.coverageKeys, '');
});

test('React release gate uses an isolated Sonar project and scoped sources', () => {
  const scope = resolveJavaScriptSonarScope('React');
  assert.equal(scope.scoped, true);
  assert.equal(scope.projectKey, 'toggly-sdks-javascript-react');
  assert.equal(scope.sources, 'Toggly.FeatureManagement.React');
  assert.equal(scope.coverageKeys, 'React');
  assert.equal(scope.manifest, SDK_SCOPES.React.manifest);
});

test('node-server release gate scopes Node packages and all server LCOV keys', () => {
  const scope = resolveJavaScriptSonarScope('node-server');
  assert.equal(scope.projectKey, 'toggly-sdks-javascript-node-server');
  assert.equal(scope.sources, 'Toggly.FeatureManagement.Node');
  assert.equal(
    scope.coverageKeys,
    'Node-Core,Node-Express,Node-Fastify,Node-Hono,Node-Koa',
  );
});

test('Docusaurus release gate includes Pages Function coverage', () => {
  const scope = resolveJavaScriptSonarScope('Docusaurus');
  assert.equal(scope.projectKey, 'toggly-sdks-javascript-docusaurus');
  assert.ok(scope.sources.includes('toggly-docusaurus-edge-sdk/cloudflare/pages-function'));
  assert.equal(scope.coverageKeys, 'Docusaurus,Docusaurus-Pages');
});

test('unknown SDK filters fail fast', () => {
  assert.throws(() => resolveJavaScriptSonarScope('NotReal'), /Unknown Sonar scope SDK/);
});
