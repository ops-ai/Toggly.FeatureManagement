import { loadToggly } from '@ops-ai/toggly-sveltekit/server';
import { env } from '$env/dynamic/private';
import type { LayoutServerLoad } from './$types';
export const load: LayoutServerLoad = async (event) => {
  event.url.searchParams.get('user');
  return {
    snapshot: await loadToggly(event),
    baseURI: env.TOGGLY_BASE_URI ?? 'https://definitions.toggly.io',
  };
};
