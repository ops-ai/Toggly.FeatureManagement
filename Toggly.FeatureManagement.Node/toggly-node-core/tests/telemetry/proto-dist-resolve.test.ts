import { describe, it, expect, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Confirms packaged/built layouts resolve proto/ without ENOENT.
 * Builds once if dist is missing so `npm test` alone still covers the Oracle finding.
 */
describe('built dist proto resolution', () => {
  beforeAll(() => {
    const distJs = path.join(packageRoot, 'dist', 'index.js')
    if (!fs.existsSync(distJs)) {
      const build = spawnSync('npm', ['run', 'build'], {
        cwd: packageRoot,
        encoding: 'utf8',
        env: process.env,
      })
      expect(build.status, build.stderr || build.stdout).toBe(0)
    }
  })

  it('createGrpcClients from dist ESM resolves usage.proto', () => {
    const distJs = path.join(packageRoot, 'dist', 'index.js')
    expect(fs.existsSync(distJs)).toBe(true)

    const script = `
      import { createGrpcClients, getProtoRoot, isGrpcAvailable } from ${JSON.stringify(pathToFileURL(distJs).href)};
      import fs from 'node:fs';
      import path from 'node:path';
      const root = getProtoRoot();
      if (!fs.existsSync(path.join(root, 'usage.proto'))) {
        console.error('ENOENT usage.proto at', root);
        process.exit(2);
      }
      if (!isGrpcAvailable()) {
        console.log('OK_SKIP_NO_GRPC');
        process.exit(0);
      }
      const clients = createGrpcClients('https://app.toggly.io/');
      if (!clients) {
        console.error('createGrpcClients returned null with grpc available');
        process.exit(3);
      }
      clients.usage.close();
      clients.metrics.close();
      console.log('OK');
    `

    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: packageRoot,
      encoding: 'utf8',
      env: process.env,
    })
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toMatch(/OK/)
  })

  it('createGrpcClients from dist CJS resolves usage.proto', () => {
    const distCjs = path.join(packageRoot, 'dist', 'index.cjs')
    expect(fs.existsSync(distCjs)).toBe(true)

    const script = `
      const { createGrpcClients, getProtoRoot, isGrpcAvailable } = require(${JSON.stringify(distCjs)});
      const fs = require('node:fs');
      const path = require('node:path');
      const root = getProtoRoot();
      if (!fs.existsSync(path.join(root, 'usage.proto'))) {
        console.error('ENOENT usage.proto at', root);
        process.exit(2);
      }
      if (!isGrpcAvailable()) {
        console.log('OK_SKIP_NO_GRPC');
        process.exit(0);
      }
      const clients = createGrpcClients('https://app.toggly.io/');
      if (!clients) {
        console.error('createGrpcClients returned null with grpc available');
        process.exit(3);
      }
      clients.usage.close();
      clients.metrics.close();
      console.log('OK');
    `

    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: packageRoot,
      encoding: 'utf8',
      env: process.env,
    })
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toMatch(/OK/)
  })
})
