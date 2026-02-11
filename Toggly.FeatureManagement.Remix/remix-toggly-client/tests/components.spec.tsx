/**
 * Tests for Feature components
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { TogglyProvider } from '../src/context';
import {
  Feature,
  FeatureEnabled,
  FeatureDisabled,
  FeatureSwitch,
  FeatureGate,
} from '../src/components/Feature';
import type { ServerFeatureContext } from '@ops-ai/remix-toggly-core';

// Helper to wrap with provider
const renderWithProvider = (
  ui: React.ReactElement,
  serverContext: ServerFeatureContext
) => {
  return render(
    <TogglyProvider serverContext={serverContext}>{ui}</TogglyProvider>
  );
};

describe('Feature component', () => {
  describe('with single feature', () => {
    it('should render children when feature is enabled', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: true },
        fetchedAt: Date.now(),
      };

      renderWithProvider(
        <Feature featureKey="feature1">
          <div data-testid="content">Enabled Content</div>
        </Feature>,
        serverContext
      );

      expect(screen.getByTestId('content')).toHaveTextContent('Enabled Content');
    });

    it('should not render children when feature is disabled', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: false },
        fetchedAt: Date.now(),
      };

      renderWithProvider(
        <Feature featureKey="feature1">
          <div data-testid="content">Enabled Content</div>
        </Feature>,
        serverContext
      );

      expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    });

    it('should render fallback when feature is disabled', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: false },
        fetchedAt: Date.now(),
      };

      renderWithProvider(
        <Feature
          featureKey="feature1"
          fallback={<div data-testid="fallback">Fallback Content</div>}
        >
          <div data-testid="content">Enabled Content</div>
        </Feature>,
        serverContext
      );

      expect(screen.queryByTestId('content')).not.toBeInTheDocument();
      expect(screen.getByTestId('fallback')).toHaveTextContent('Fallback Content');
    });

    it('should use default value for missing feature', () => {
      const serverContext: ServerFeatureContext = {
        flags: {},
        fetchedAt: Date.now(),
      };

      renderWithProvider(
        <Feature featureKey="missing" defaultValue={true}>
          <div data-testid="content">Content</div>
        </Feature>,
        serverContext
      );

      expect(screen.getByTestId('content')).toBeInTheDocument();
    });

    it('should negate when negate is true', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: true },
        fetchedAt: Date.now(),
      };

      renderWithProvider(
        <Feature featureKey="feature1" negate>
          <div data-testid="content">Content</div>
        </Feature>,
        serverContext
      );

      expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    });
  });

  describe('with multiple features', () => {
    it('should render when all features enabled (requirement: all)', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: true, feature2: true },
        fetchedAt: Date.now(),
      };

      renderWithProvider(
        <Feature featureKeys={['feature1', 'feature2']} requirement="all">
          <div data-testid="content">Content</div>
        </Feature>,
        serverContext
      );

      expect(screen.getByTestId('content')).toBeInTheDocument();
    });

    it('should not render when not all features enabled (requirement: all)', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: true, feature2: false },
        fetchedAt: Date.now(),
      };

      renderWithProvider(
        <Feature featureKeys={['feature1', 'feature2']} requirement="all">
          <div data-testid="content">Content</div>
        </Feature>,
        serverContext
      );

      expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    });

    it('should render when any feature enabled (requirement: any)', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: true, feature2: false },
        fetchedAt: Date.now(),
      };

      renderWithProvider(
        <Feature featureKeys={['feature1', 'feature2']} requirement="any">
          <div data-testid="content">Content</div>
        </Feature>,
        serverContext
      );

      expect(screen.getByTestId('content')).toBeInTheDocument();
    });
  });

  describe('with render prop', () => {
    it('should use render prop when provided', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: true },
        fetchedAt: Date.now(),
      };

      renderWithProvider(
        <Feature
          featureKey="feature1"
          render={(enabled) => (
            <div data-testid="content">{enabled ? 'Enabled' : 'Disabled'}</div>
          )}
        />,
        serverContext
      );

      expect(screen.getByTestId('content')).toHaveTextContent('Enabled');
    });

    it('should pass correct enabled state to render prop', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: false },
        fetchedAt: Date.now(),
      };

      renderWithProvider(
        <Feature
          featureKey="feature1"
          render={(enabled) => (
            <div data-testid="content">{enabled ? 'Enabled' : 'Disabled'}</div>
          )}
        />,
        serverContext
      );

      expect(screen.getByTestId('content')).toHaveTextContent('Disabled');
    });
  });

  describe('edge cases', () => {
    it('should handle empty feature keys', () => {
      const serverContext: ServerFeatureContext = {
        flags: {},
        fetchedAt: Date.now(),
      };

      renderWithProvider(
        <Feature defaultValue={true}>
          <div data-testid="content">Content</div>
        </Feature>,
        serverContext
      );

      expect(screen.getByTestId('content')).toBeInTheDocument();
    });
  });
});

describe('FeatureEnabled component', () => {
  it('should render children when feature is enabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      fetchedAt: Date.now(),
    };

    renderWithProvider(
      <FeatureEnabled featureKey="feature1">
        <div data-testid="content">Content</div>
      </FeatureEnabled>,
      serverContext
    );

    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('should not render children when feature is disabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: false },
      fetchedAt: Date.now(),
    };

    renderWithProvider(
      <FeatureEnabled featureKey="feature1">
        <div data-testid="content">Content</div>
      </FeatureEnabled>,
      serverContext
    );

    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
  });
});

describe('FeatureDisabled component', () => {
  it('should render children when feature is disabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: false },
      fetchedAt: Date.now(),
    };

    renderWithProvider(
      <FeatureDisabled featureKey="feature1">
        <div data-testid="content">Content</div>
      </FeatureDisabled>,
      serverContext
    );

    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('should not render children when feature is enabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      fetchedAt: Date.now(),
    };

    renderWithProvider(
      <FeatureDisabled featureKey="feature1">
        <div data-testid="content">Content</div>
      </FeatureDisabled>,
      serverContext
    );

    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
  });
});

describe('FeatureSwitch component', () => {
  it('should render enabled content when feature is enabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      fetchedAt: Date.now(),
    };

    renderWithProvider(
      <FeatureSwitch
        featureKey="feature1"
        enabled={<div data-testid="enabled">Enabled</div>}
        disabled={<div data-testid="disabled">Disabled</div>}
      />,
      serverContext
    );

    expect(screen.getByTestId('enabled')).toBeInTheDocument();
    expect(screen.queryByTestId('disabled')).not.toBeInTheDocument();
  });

  it('should render disabled content when feature is disabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: false },
      fetchedAt: Date.now(),
    };

    renderWithProvider(
      <FeatureSwitch
        featureKey="feature1"
        enabled={<div data-testid="enabled">Enabled</div>}
        disabled={<div data-testid="disabled">Disabled</div>}
      />,
      serverContext
    );

    expect(screen.queryByTestId('enabled')).not.toBeInTheDocument();
    expect(screen.getByTestId('disabled')).toBeInTheDocument();
  });
});

describe('FeatureGate component', () => {
  it('should render children when all features enabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true, feature2: true },
      fetchedAt: Date.now(),
    };

    renderWithProvider(
      <FeatureGate featureKeys={['feature1', 'feature2']} requirement="all">
        <div data-testid="content">Content</div>
      </FeatureGate>,
      serverContext
    );

    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('should render fallback when gate fails', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true, feature2: false },
      fetchedAt: Date.now(),
    };

    renderWithProvider(
      <FeatureGate
        featureKeys={['feature1', 'feature2']}
        requirement="all"
        fallback={<div data-testid="fallback">Fallback</div>}
      >
        <div data-testid="content">Content</div>
      </FeatureGate>,
      serverContext
    );

    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('should support any requirement', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true, feature2: false },
      fetchedAt: Date.now(),
    };

    renderWithProvider(
      <FeatureGate featureKeys={['feature1', 'feature2']} requirement="any">
        <div data-testid="content">Content</div>
      </FeatureGate>,
      serverContext
    );

    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('should support negation', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      fetchedAt: Date.now(),
    };

    renderWithProvider(
      <FeatureGate featureKeys={['feature1']} negate>
        <div data-testid="content">Content</div>
      </FeatureGate>,
      serverContext
    );

    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
  });
});
