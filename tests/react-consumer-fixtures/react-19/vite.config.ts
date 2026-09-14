import { defineConfig } from 'vite'

// Keep JSX behavior explicit for this packed host.
// Its conventional tsconfig.json lets static analysis recognize this
// independent test project outside SDK production source roots.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
})
