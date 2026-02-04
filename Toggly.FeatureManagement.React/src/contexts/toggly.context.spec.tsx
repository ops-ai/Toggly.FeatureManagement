import React, { useContext } from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { context, Provider, Consumer, TogglyContext } from './toggly.context';
import { Toggly } from '../services';

describe('Toggly Context', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should export context, Provider, Consumer', () => {
    expect(context).toBeDefined();
    expect(Provider).toBeDefined();
    expect(Consumer).toBeDefined();
  });

  it('should have undefined toggly by default', () => {
    function ContextReader() {
      const ctx = useContext(context);
      return <span data-testid="val">{ctx.toggly ? 'yes' : 'no'}</span>;
    }

    render(<ContextReader />);
    expect(screen.getByTestId('val')).toHaveTextContent('no');
  });

  it('should provide toggly service via Provider', () => {
    const service = new Toggly({ featureDefaults: { F1: true } });

    function ContextReader() {
      const ctx = useContext(context);
      return <span data-testid="val">{ctx.toggly ? 'yes' : 'no'}</span>;
    }

    render(
      <Provider value={{ toggly: service }}>
        <ContextReader />
      </Provider>
    );

    expect(screen.getByTestId('val')).toHaveTextContent('yes');
  });

  it('should work with Consumer render prop', () => {
    const service = new Toggly({ featureDefaults: { F1: true } });

    render(
      <Provider value={{ toggly: service }}>
        <Consumer>
          {(ctx: TogglyContext) => (
            <span data-testid="consumer">
              {ctx.toggly ? 'has-service' : 'no-service'}
            </span>
          )}
        </Consumer>
      </Provider>
    );

    expect(screen.getByTestId('consumer')).toHaveTextContent('has-service');
  });
});
