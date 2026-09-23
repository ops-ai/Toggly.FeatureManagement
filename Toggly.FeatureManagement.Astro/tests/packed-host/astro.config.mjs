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
    baseURI: process.env.DEFINITIONS_URL, metricsBaseUrl: process.env.METRICS_URL,
    appKey: 'packed-host', environment: 'Test',
    enableUsageTracking: false, enableMetrics: false,
    browserEnableUsageTracking: true, browserEnableMetrics: true,
    telemetryAttachProcessHandlers: false, usageFlushInterval: 0,
    verifySignatures: true, flagDefaults: { Visible: false, Hidden: false },
    featureFlagsRefreshInterval: 0, enableLiveUpdates: false,
  }), {
    name: 'verify-integration-server-policy',
    hooks: {
      'astro:server:setup': ({server}) => {
        server.middlewares.use((request, _response, next) => {
          const owner = request.togglyClient;
          if (!owner || owner.telemetry !== null || owner.config.enableUsageTracking !== false ||
              'browserEnableUsageTracking' in owner.config || 'browserEnableMetrics' in owner.config) {
            next(new Error('Integration server policy changed')); return;
          }
          next();
        });
      },
    },
  }],
});
