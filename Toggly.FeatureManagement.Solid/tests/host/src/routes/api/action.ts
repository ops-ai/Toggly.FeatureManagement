import type { APIEvent } from '@solidjs/start/server';
import { scope } from '../../lib/flags.server';
export async function POST(event: APIEvent) {
  const identity = event.request.headers.get('x-test-identity') ?? '';
  const flags = await scope(identity, event.request);
  try {
    await flags.requireFeature('BetaDashboard');
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  } finally {
    flags.dispose();
  }
}
