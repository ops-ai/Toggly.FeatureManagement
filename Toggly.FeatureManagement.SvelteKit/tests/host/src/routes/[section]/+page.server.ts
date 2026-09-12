import { requireFeature } from '@ops-ai/toggly-sveltekit/server';
import type { PageServerLoad, Actions } from './$types';
export const load: PageServerLoad = async (event) => {
  if (event.params.section === 'denied') await requireFeature(event, 'missing');
  return { serverOn: await event.locals.toggly.isEnabled('on') };
};
export const actions: Actions = {
  submit: async (event) => {
    await requireFeature(event, 'on');
    return { message: 'accepted' };
  },
};
