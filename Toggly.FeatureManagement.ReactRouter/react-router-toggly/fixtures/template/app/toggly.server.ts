import { createTogglyLoader, createFeatureGatedAction } from '@ops-ai/react-router-toggly/server';

const options = {
  appKey: 'host-test-key',
  environment: 'Development',
  featureDefaults: {
    Visible: true,
    Hidden: false,
    ServerOnly: true,
  },
  getIdentity: async () => 'host-user-1',
  enableUsageTracking: false,
  enableMetrics: false,
};

export const toggly = createTogglyLoader(options);

export const gatedAction = createFeatureGatedAction(
  {
    ...options,
    requiredFeatures: 'Hidden',
  },
  async () => ({ secret: true }),
);
