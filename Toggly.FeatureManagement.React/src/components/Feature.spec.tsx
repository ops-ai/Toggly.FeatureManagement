import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Feature from './Feature';
import { Provider } from '../contexts/toggly.context';
import { Toggly, TogglyService } from '../services';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// Helper: wrap Feature in a context provider with a Toggly service
function renderFeature(
  service: TogglyService,
  props: {
    featureKey?: string;
    featureKeys?: string[];
    requirement?: string;
    negate?: boolean;
    children?: React.ReactNode;
    variant?: string;
  }
) {
  return render(
    <Provider value={{ toggly: service }}>
      <Feature {...props}>
        {props.children ?? <span data-testid="content">Visible</span>}
      </Feature>
    </Provider>
  );
}

describe('Feature Component', () => {
  let service: Toggly;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    service = new Toggly({
      featureDefaults: { Enabled: true, Disabled: false, A: true, B: true, C: false },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Basic rendering', () => {
    it('should render children when feature is enabled', async () => {
      renderFeature(service, { featureKey: 'Enabled' });

      await waitFor(() => {
        expect(screen.getByTestId('content')).toBeInTheDocument();
      });
    });

    it('should not render children when feature is disabled', async () => {
      renderFeature(service, { featureKey: 'Disabled' });

      // Wait a tick for componentDidMount to resolve
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    });

    it('should not render children for unknown feature', async () => {
      renderFeature(service, { featureKey: 'Unknown' });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    });
  });

  describe('featureKeys prop', () => {
    it('should render when all feature keys are enabled', async () => {
      renderFeature(service, { featureKeys: ['A', 'B'] });

      await waitFor(() => {
        expect(screen.getByTestId('content')).toBeInTheDocument();
      });
    });

    it('should not render when some feature keys are disabled (all requirement)', async () => {
      renderFeature(service, { featureKeys: ['A', 'C'] });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    });
  });

  describe('requirement prop', () => {
    it('should render when any feature is enabled (requirement: any)', async () => {
      renderFeature(service, {
        featureKeys: ['A', 'C'],
        requirement: 'any',
      });

      await waitFor(() => {
        expect(screen.getByTestId('content')).toBeInTheDocument();
      });
    });

    it('should not render when no feature is enabled (requirement: any)', async () => {
      renderFeature(service, {
        featureKeys: ['C'],
        requirement: 'any',
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    });
  });

  describe('negate prop', () => {
    it('should hide children when feature is enabled and negate is true', async () => {
      renderFeature(service, { featureKey: 'Enabled', negate: true });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    });

    it('should show children when feature is disabled and negate is true', async () => {
      renderFeature(service, { featureKey: 'Disabled', negate: true });

      await waitFor(() => {
        expect(screen.getByTestId('content')).toBeInTheDocument();
      });
    });
  });

  describe('Combined featureKey and featureKeys', () => {
    it('should combine featureKey and featureKeys into gate', async () => {
      renderFeature(service, {
        featureKey: 'A',
        featureKeys: ['B'],
        requirement: 'all',
      });

      await waitFor(() => {
        expect(screen.getByTestId('content')).toBeInTheDocument();
      });
    });

    it('should not render when combined gate fails (all requirement)', async () => {
      renderFeature(service, {
        featureKey: 'A',
        featureKeys: ['C'],
        requirement: 'all',
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    });
  });

  describe('variant prop', () => {
    it('renders when gate passes and variant matches', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            defs: {
              Rollout: { enabled: true, variant: 'B' },
            },
          }),
      });

      const variantService = new Toggly({
        appKey: 'app',
        environment: 'Production',
        enableVariants: true,
        enableLiveUpdates: false,
      });

      await variantService._loadFeatures();

      renderFeature(variantService, {
        featureKey: 'Rollout',
        variant: 'B',
      });

      await waitFor(() => {
        expect(screen.getByTestId('content')).toBeInTheDocument();
      });
    });

    it('hides when variant does not match', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            defs: {
              Rollout: { enabled: true, variant: 'A' },
            },
          }),
      });

      const variantService = new Toggly({
        appKey: 'app',
        environment: 'Production',
        enableVariants: true,
        enableLiveUpdates: false,
      });

      await variantService._loadFeatures();

      renderFeature(variantService, {
        featureKey: 'Rollout',
        variant: 'B',
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    });
  });

  describe('Empty gate', () => {
    it('should not call evaluateFeatureGate for empty gate', async () => {
      const evalSpy = jest.spyOn(service, 'evaluateFeatureGate');

      renderFeature(service, {});

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(evalSpy).not.toHaveBeenCalled();
    });
  });

  describe('Custom children', () => {
    it('should render complex children when feature is on', async () => {
      renderFeature(service, {
        featureKey: 'Enabled',
        children: (
          <div data-testid="complex">
            <h1>Title</h1>
            <p>Description</p>
          </div>
        ),
      });

      await waitFor(() => {
        expect(screen.getByTestId('complex')).toBeInTheDocument();
        expect(screen.getByText('Title')).toBeInTheDocument();
      });
    });
  });

  describe('render prop', () => {
    it('should invoke render with enabled boolean while keeping content mounted', async () => {
      render(
        <Provider value={{ toggly: service }}>
          <Feature
            featureKey="Enabled"
            render={(enabled) => (
              <span data-testid="render-prop">{enabled ? 'active' : 'inactive'}</span>
            )}
          />
        </Provider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('render-prop')).toHaveTextContent('active');
      });
    });

    it('should pass false when feature is disabled', async () => {
      render(
        <Provider value={{ toggly: service }}>
          <Feature
            featureKey="Disabled"
            render={(enabled) => (
              <span data-testid="render-prop">{enabled ? 'active' : 'inactive'}</span>
            )}
          />
        </Provider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('render-prop')).toHaveTextContent('inactive');
      });
    });

    it('should render fallback when feature is disabled', async () => {
      render(
        <Provider value={{ toggly: service }}>
          <Feature
            featureKey="Disabled"
            fallback={<span data-testid="fallback">hidden</span>}
          >
            <span data-testid="content">Visible</span>
          </Feature>
        </Provider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('fallback')).toBeInTheDocument();
        expect(screen.queryByTestId('content')).not.toBeInTheDocument();
      });
    });
  });
});
