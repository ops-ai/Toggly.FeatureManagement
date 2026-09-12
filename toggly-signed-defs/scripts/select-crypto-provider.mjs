import { copyFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Keep the shared verifier unchanged across targets; replace only its provider.
for (const target of ['', 'esm/', 'browser/']) {
  for (const extension of ['js', 'd.ts']) {
    const browserProvider = fileURLToPath(new URL(`../dist/${target}webcrypto.browser.${extension}`, import.meta.url))
    if (target === 'browser/') {
      copyFileSync(browserProvider, fileURLToPath(new URL(`../dist/${target}webcrypto.${extension}`, import.meta.url)))
      unlinkSync(browserProvider)
    }
  }
}

// CI overlays dist into older installed manifests. Keep browser selection
// beside the compiled graph so legacy main/module consumers also select it.
writeFileSync(fileURLToPath(new URL('../dist/package.json', import.meta.url)), `${JSON.stringify({
  type: 'commonjs',
  browser: { './webcrypto.js': './webcrypto.browser.js' },
}, null, 2)}\n`)
