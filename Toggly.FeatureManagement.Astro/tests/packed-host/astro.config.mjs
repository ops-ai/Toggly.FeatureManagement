import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import vue from '@astrojs/vue';
import svelte from '@astrojs/svelte';
import toggly from '@ops-ai/astro-feature-flags-toggly/integration';

const staticBuild = process.env.HOST_OUTPUT === 'static';
const islands = { react: react(), vue: vue(), svelte: svelte() };
const islandIntegrations = process.env.HOST_ISLAND ? [islands[process.env.HOST_ISLAND]] : Object.values(islands);
export default defineConfig({
  output: staticBuild ? 'static' : 'server',
  adapter: staticBuild ? undefined : node({ mode: 'standalone' }),
  integrations: [...islandIntegrations, toggly({
    baseURI: process.env.DEFINITIONS_URL,
    appKey: 'packed-host', environment: 'Test',
    verifySignatures: true, flagDefaults: { Visible: false, Hidden: false },
    featureFlagsRefreshInterval: 0, enableLiveUpdates: false,
  })],
});
