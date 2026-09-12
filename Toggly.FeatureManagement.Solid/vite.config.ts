import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
export default defineConfig({ plugins: [solid()], build: { emptyOutDir: false, lib: { entry: 'src/index.tsx', formats: ['es'], fileName: 'index' }, rollupOptions: { external: [/^solid-js/, /^@ops-ai/] } } });
