import { defineMiddleware } from 'astro:middleware';
import { createTogglyMiddleware } from '@ops-ai/astro-feature-flags-toggly/integration';

export const onRequest = defineMiddleware(async (context, next) => {
  const middleware = createTogglyMiddleware({
    baseURI: process.env.DEFINITIONS_URL,
    appKey: 'packed-host', environment: 'Test',
    enableUsageTracking: false, telemetryAttachProcessHandlers: false,
    metricsBaseUrl: process.env.METRICS_URL,
    identity: context.url.searchParams.get('identity') ?? undefined,
    claims: { role: context.url.searchParams.get('role') ?? 'user' },
    verifySignatures: true, flagDefaults: { Visible: false, Hidden: false },
    featureFlagsRefreshInterval: 0,
    enableLiveUpdates: false,
  });
  return middleware(context, async () => {
    // Inspect the actual packed request owner before any flag evaluation.
    if ((context.locals.toggly as unknown as { telemetry: unknown }).telemetry !== null) {
      throw new Error('Request server telemetry unexpectedly started');
    }
    if (context.url.pathname === '/gated/' && !await context.locals.toggly.getFlag('Visible')) {
      return new Response('page-disabled', { status: 404 });
    }
    const response = await next();
    response.headers.set('x-toggly-middleware', 'applied');
    return response;
  });
});
