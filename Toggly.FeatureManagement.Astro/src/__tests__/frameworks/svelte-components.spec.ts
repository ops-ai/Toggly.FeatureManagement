// @vitest-environment node
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

describe('distributed Svelte components', () => {
  for (const component of ['Feature', 'FeatureGateBuilder']) {
    for (const generate of ['client', 'server'] as const) {
      it(`compiles ${component} for ${generate} with real Svelte`, () => {
        const filename = new URL(`../../frameworks/svelte/${component}.svelte`, import.meta.url);
        const result = compile(readFileSync(filename, 'utf8'), { filename: filename.pathname, generate });
        expect(result.js.code).toBeTruthy();
        expect(result.warnings).toEqual([]);
      });
    }
  }
});
