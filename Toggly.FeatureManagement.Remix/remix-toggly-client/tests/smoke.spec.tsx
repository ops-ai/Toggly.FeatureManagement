import React from 'react';
import { render } from '@testing-library/react';
import https from 'node:https';
import type { ServerFeatureContext } from '@ops-ai/remix-toggly-core';
import { TogglyProvider, useTogglyContext } from '../src/context';

function TestConsumer({
  onContext,
}: {
  onContext: (value: ReturnType<typeof useTogglyContext>) => void;
}) {
  const context = useTogglyContext();
  onContext(context);
  return null;
}

function fetchLiveFlags(appKey: string): Promise<Record<string, boolean>> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://definitions.toggly.io/evaluated-signed/${appKey}/Production`,
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const payload = JSON.parse(data) as { defs?: Record<string, boolean> } | Record<string, boolean>;
            resolve('defs' in payload ? (payload.defs ?? {}) : payload);
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on('error', reject);
  });
}

const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

(appKey ? describe : describe.skip)('Smoke test', () => {
  it('evaluates live flags through client context', async () => {
    const flags = await fetchLiveFlags(appKey!);
    const serverContext: ServerFeatureContext = {
      flags,
      appKey,
      environment: 'Production',
      fetchedAt: Date.now(),
    };

    let capturedContext: ReturnType<typeof useTogglyContext> | undefined;

    render(
      <TogglyProvider serverContext={serverContext}>
        <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
      </TogglyProvider>
    );

    expect(capturedContext?.isEnabled('FlagOn')).toBe(true);
    expect(capturedContext?.isDisabled('FlagOff')).toBe(true);
  });
});
