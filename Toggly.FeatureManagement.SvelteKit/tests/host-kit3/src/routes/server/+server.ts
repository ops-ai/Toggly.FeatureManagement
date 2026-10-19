import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async (event) =>
  json({
    on: await event.locals.toggly.isEnabled('on'),
    all: await event.locals.toggly.gate(['on', 'off']),
    any: await event.locals.toggly.gate(['on', 'off'], { requirement: 'any' }),
    negate: await event.locals.toggly.gate(['off'], { negate: true }),
    vip: await event.locals.toggly.isEnabled('Order', {
      entity: { kind: 'Order', key: '1', attributes: { Vip: true } },
    }),
    noEntity: await event.locals.toggly.isEnabled('Order'),
  });
