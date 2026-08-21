import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Toggly from './toggly.service';
import Feature from '../components/Feature/Feature';
import { Provider } from '../contexts/toggly.context';
import { clearRegisteredContexts, type EntityGate } from '@ops-ai/toggly-hooks-types';

const datetimeGate: EntityGate = {
  requirement: 'all',
  rules: [{ property: 'BirthDate', op: 'gt', value: '2026-01-01', type: 'datetime' }],
};

describe('Entity context evaluation', () => {
  let service: Toggly;

  beforeEach(() => {
    clearRegisteredContexts();
    localStorage.clear();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    service = new Toggly({
      featureDefaults: {
        PlainOn: true,
        PlainOff: false,
        EntityGated: datetimeGate,
      },
    });
  });

  afterEach(() => {
    clearRegisteredContexts();
    jest.restoreAllMocks();
  });

  it('fails closed for entity gates without context', async () => {
    await expect(service.isFeatureOn('EntityGated')).resolves.toBe(false);
  });

  it('evaluates entity gates with TogglyEntityContext', async () => {
    await expect(
      service.isFeatureOn('EntityGated', {
        kind: 'Puppy',
        key: '1',
        attributes: { BirthDate: '2026-06-15T00:00:00Z' },
      }),
    ).resolves.toBe(true);
  });

  it('evaluates entity gates via registerContext mapper', async () => {
    service.registerContext<{ id: string; birthDate: string }>('Puppy', (puppy) => ({
      kind: 'Puppy',
      key: puppy.id,
      attributes: { BirthDate: puppy.birthDate },
    }));

    await expect(
      service.isFeatureOn('EntityGated', { id: '42', birthDate: '2026-06-15T00:00:00Z' }, 'Puppy'),
    ).resolves.toBe(true);
  });

  it('leaves plain booleans unchanged without context', async () => {
    await expect(service.isFeatureOn('PlainOn')).resolves.toBe(true);
    await expect(service.isFeatureOn('PlainOff')).resolves.toBe(false);
  });

  it('Feature component accepts context prop', async () => {
    render(
      <Provider value={{ toggly: service }}>
        <Feature
          featureKey="EntityGated"
          context={{
            kind: 'Puppy',
            key: '1',
            attributes: { BirthDate: '2026-06-15T00:00:00Z' },
          }}
        >
          <span data-testid="badge">Badge</span>
        </Feature>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('badge')).toBeInTheDocument();
    });
  });

  it('Feature component hides entity gate without context', async () => {
    render(
      <Provider value={{ toggly: service }}>
        <Feature featureKey="EntityGated">
          <span data-testid="badge">Badge</span>
        </Feature>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('badge')).not.toBeInTheDocument();
    });
  });
});
