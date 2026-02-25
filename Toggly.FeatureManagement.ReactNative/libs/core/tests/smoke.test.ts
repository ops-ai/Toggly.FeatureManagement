import https from 'node:https';
import { TogglyService } from '../src/services/TogglyService';

type MockFetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
};

const fetchViaHttps = (url: string): Promise<MockFetchResponse> =>
  new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        const status = res.statusCode ?? 500;
        const statusText = res.statusMessage ?? '';
        const etag = Array.isArray(res.headers.etag) ? res.headers.etag[0] : res.headers.etag;

        resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText,
          headers: {
            get: (name: string) => (name.toLowerCase() === 'etag' && etag ? etag : null),
          },
          json: async () => JSON.parse(body),
        });
      });
    });

    req.on('error', reject);
  });

const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

(appKey ? describe : describe.skip)('Smoke test', () => {
  it('loads live evaluated flags', async () => {
    const originalFetch = global.fetch;
    (global.fetch as unknown as jest.Mock).mockImplementation((url: string) =>
      fetchViaHttps(url)
    );

    const service = new TogglyService({
      appKey: appKey!,
      environment: 'Production',
      baseURI: 'https://definitions.toggly.io',
      refreshInterval: 0,
    });

    try {
      await service.init();

      await expect(service.isFeatureOn('FlagOn')).resolves.toBe(true);
      await expect(service.isFeatureOff('FlagOff')).resolves.toBe(true);
    } finally {
      service.dispose();
      global.fetch = originalFetch;
    }
  });
});
