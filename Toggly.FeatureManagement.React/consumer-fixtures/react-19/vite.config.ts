import { defineConfig } from 'vite'

// Keep JSX behavior explicit for this packed host without using tsconfig.json.
// Sonar discovers every file named tsconfig.json below SDK source roots and
// otherwise reclassifies the fixture's test-only program as production code.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
})
