import { loadToggly } from '@ops-ai/toggly-sveltekit/server';
import { env } from '$env/dynamic/private';
import type { LayoutServerLoad } from './$types';
export const load: LayoutServerLoad = async (event) => {
  event.url.searchParams.get('user');
  event.url.searchParams.get('instance');
  return {
    snapshot: await loadToggly(event),
    frontendKey: event.url.searchParams.get('frontendKey') ?? 'frontend-fixture',
    telemetryEnabled: event.url.searchParams.get('telemetry') !== 'false',
    baseURI: env.TOGGLY_BASE_URI ?? 'https://definitions.toggly.io',
  };
};
