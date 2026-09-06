/**
 * Covers gRPC optional-dep warning path [OPS-923]
 */

jest.mock('@ops-ai/remix-toggly-core/telemetry/grpc', () => ({
  isGrpcAvailable: () => false,
  createGrpcClients: jest.fn(() => null),
}));

jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(),
    removeAllListeners: jest.fn(),
    send: jest.fn(),
    readyState: 1,
  }));
});

import { TogglyServerClient } from '../src/client';

describe('TogglyServerClient telemetry without gRPC deps', () => {
  it('warns when usage is enabled but gRPC packages are missing', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const client = new TogglyServerClient({
      appKey: 'app',
      environment: 'Production',
      featureDefaults: { FeatureA: true },
      enableUsageTracking: true,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      telemetryAttachProcessHandlers: false,
      telemetryTransport: 'grpc',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('@grpc/grpc-js'),
    );
    client.close();
    warn.mockRestore();
  });
});
