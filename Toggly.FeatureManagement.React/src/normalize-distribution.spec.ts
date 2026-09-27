/** @jest-environment node */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

describe('normalize-distribution', () => {
  it('trims trailing spaces and tabs before every JavaScript line terminator', () => {
    const root = mkdtempSync(join(tmpdir(), 'toggly-react-normalize-'))
    const source = 'crlf \t\r\ncr \t\runicode \t\u2028paragraph \t\u2029final \t'
    const expected = 'crlf\ncr\runicode\u2028paragraph\u2029final'

    try {
      mkdirSync(join(root, 'dist/cjs'), { recursive: true })
      mkdirSync(join(root, 'dist/esm'), { recursive: true })
      writeFileSync(join(root, 'dist/cjs/index.cjs'), source)
      writeFileSync(join(root, 'dist/esm/index.js'), source)

      execFileSync(process.execPath, [resolve('scripts/normalize-distribution.mjs')], {
        cwd: root,
      })

      expect(readFileSync(join(root, 'dist/cjs/index.cjs'), 'utf8')).toBe(expected)
      expect(readFileSync(join(root, 'dist/esm/index.js'), 'utf8')).toBe(expected)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
