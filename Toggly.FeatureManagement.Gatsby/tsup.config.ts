import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'hooks/index': 'src/hooks/index.ts',
    'components/index': 'src/components/index.ts',
    'client/store': 'src/client/store.ts',
    'server/toggly-server': 'src/server/toggly-server.ts',
    'plugin/gatsby-node': 'src/plugin/gatsby-node.ts',
    'plugin/gatsby-ssr': 'src/plugin/gatsby-ssr.tsx',
    'plugin/gatsby-browser': 'src/plugin/gatsby-browser.tsx',
    'utils/manifest-generator': 'src/utils/manifest-generator.ts',
    'utils/frontmatter-extractor': 'src/utils/frontmatter-extractor.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    'gatsby',
    'react',
    'react-dom',
    'nanostores',
    '@nanostores/react',
  ],
  splitting: false,
  treeshake: true,
});
