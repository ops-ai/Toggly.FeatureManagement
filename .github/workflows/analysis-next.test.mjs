import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
const workflow = readFileSync(new URL('./analysis-next.yml', import.meta.url), 'utf8')
test('preserves the Node matrix and runs packed Next browser hosts on its supported Node 22 row', () => {
  assert.match(workflow, /node-version: \[18\.x, 20\.x, 22\.x\]/)
  assert.match(workflow, /- name: Verify packed browser hosts\n\s+if: matrix\.node-version == '22\.x'\n\s+working-directory: \$\{\{ env\.SDK_ROOT \}\}\n\s+env:\n\s+CHROME_BIN: \/usr\/bin\/google-chrome\n\s+run: pnpm test:hosts/)
})
test('classifies the Next browser host harness and fixture as tests in both scans', () => {
  const exclusions = [...workflow.matchAll(/-Dsonar\.exclusions=([^\n]+)/g)].map(match => match[1])
  const inclusions = [...workflow.matchAll(/-Dsonar\.test\.inclusions=([^\n]+)/g)].map(match => match[1])
  for (const list of [exclusions, inclusions]) {
    assert.equal(list.length, 2)
    for (const value of list) {
      assert.ok(value.includes('Toggly.FeatureManagement.Next/scripts/**'))
      assert.ok(value.includes('Toggly.FeatureManagement.Next/tests/browser-host/**'))
    }
  }
})
