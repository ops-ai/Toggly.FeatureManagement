import { describe, it, expect } from 'vitest';
import { Toggly } from '../plugins/toggly.service';

const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

describe('Smoke test', () => {
  it('loads live evaluated flags', async () => {
    if (!appKey) throw new Error('TOGGLY_SMOKE_APP_KEY_FRONTEND is not configured — set this env var to run smoke tests');
    const service = new Toggly().init({
      appKey: appKey!,
      enableTelemetry: false, // Definitions smoke is not a telemetry ingestion fixture.
      environment: 'Production',
      baseURI: 'https://definitions.toggly.io',
    });

    try {
      await expect(service.isFeatureOn('FlagOn')).resolves.toBe(true);
      await expect(service.isFeatureOff('FlagOff')).resolves.toBe(true);
    } finally {
      service.dispose();
    }
  });
});
