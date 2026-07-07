import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import FeatureGateBuilderHost from './FeatureGateBuilderHost.svelte';
import { togglyServiceStore, togglyFlagsStore } from '../stores/toggly.store';
import { Toggly } from '../services/toggly.service';

describe('FeatureGateBuilder', () => {
  let service: Toggly;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    service = new Toggly({
      featureDefaults: { Enabled: true, Disabled: false },
    });
    togglyServiceStore.set(service);
    togglyFlagsStore.set({ Enabled: true, Disabled: false });
  });

  afterEach(() => {
    togglyServiceStore.set(null);
    togglyFlagsStore.set({});
    vi.restoreAllMocks();
  });

  it('exposes enabled=true via slot prop', async () => {
    const { getByTestId } = render(FeatureGateBuilderHost, {
      props: { featureKey: 'Enabled' },
    });

    await waitFor(() => {
      expect(getByTestId('state').textContent).toBe('on')
    })
  })

  it('exposes enabled=false when feature is disabled', async () => {
    togglyFlagsStore.set({ Enabled: true, Disabled: false })
    const { getByTestId } = render(FeatureGateBuilderHost, {
      props: { featureKey: 'Disabled' },
    })

    await waitFor(() => {
      expect(getByTestId('state').textContent).toBe('off')
    })
  })
})
