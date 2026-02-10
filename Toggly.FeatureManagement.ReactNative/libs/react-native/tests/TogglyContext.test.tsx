import React from 'react';
import { render } from '@testing-library/react';
import { TogglyContext, TogglyContextValue, useTogglyContext, useTogglyService } from '../src/contexts/TogglyContext';

// Mock TogglyService
const mockTogglyService = {
  init: jest.fn().mockResolvedValue(undefined),
  dispose: jest.fn(),
  refresh: jest.fn().mockResolvedValue(undefined),
  isFeatureOn: jest.fn().mockResolvedValue(true),
  isFeatureOff: jest.fn().mockResolvedValue(false),
  evaluateFeatureGate: jest.fn().mockResolvedValue(true),
  on: jest.fn().mockReturnValue(() => {}),
  addStateChangeHandler: jest.fn().mockReturnValue(() => {}),
  setIdentity: jest.fn().mockResolvedValue(undefined),
  getDebugInfo: jest.fn().mockReturnValue({ version: '1.0.0' }),
  currentIdentity: 'test-user',
  currentFeatures: { feature1: true },
  shouldShowFeatureDuringEvaluation: false,
} as any;

describe('TogglyContext', () => {
  describe('useTogglyContext', () => {
    it('throws error when used outside of TogglyProvider', () => {
      const TestComponent = () => {
        useTogglyContext();
        return null;
      };

      // Suppress console.error for this test
      const originalError = console.error;
      console.error = jest.fn();

      expect(() => {
        render(<TestComponent />);
      }).toThrow('useTogglyContext must be used within a TogglyProvider');

      console.error = originalError;
    });

    it('returns context value when used inside provider', () => {
      let contextValue: TogglyContextValue | null = null;

      const TestComponent = () => {
        contextValue = useTogglyContext();
        return null;
      };

      const mockValue: TogglyContextValue = {
        toggly: mockTogglyService,
        isReady: true,
        isLoading: false,
        error: null,
      };

      render(
        <TogglyContext.Provider value={mockValue}>
          <TestComponent />
        </TogglyContext.Provider>
      );

      expect(contextValue).toEqual(mockValue);
    });

    it('provides correct isReady state', () => {
      let isReady: boolean | undefined;

      const TestComponent = () => {
        const context = useTogglyContext();
        isReady = context.isReady;
        return null;
      };

      const mockValue: TogglyContextValue = {
        toggly: mockTogglyService,
        isReady: false,
        isLoading: true,
        error: null,
      };

      render(
        <TogglyContext.Provider value={mockValue}>
          <TestComponent />
        </TogglyContext.Provider>
      );

      expect(isReady).toBe(false);
    });

    it('provides error state when present', () => {
      let error: Error | null = null;

      const TestComponent = () => {
        const context = useTogglyContext();
        error = context.error;
        return null;
      };

      const testError = new Error('Test error');
      const mockValue: TogglyContextValue = {
        toggly: mockTogglyService,
        isReady: false,
        isLoading: false,
        error: testError,
      };

      render(
        <TogglyContext.Provider value={mockValue}>
          <TestComponent />
        </TogglyContext.Provider>
      );

      expect(error).toBe(testError);
    });
  });

  describe('useTogglyService', () => {
    it('returns the toggly service instance', () => {
      let service: any = null;

      const TestComponent = () => {
        service = useTogglyService();
        return null;
      };

      const mockValue: TogglyContextValue = {
        toggly: mockTogglyService,
        isReady: true,
        isLoading: false,
        error: null,
      };

      render(
        <TogglyContext.Provider value={mockValue}>
          <TestComponent />
        </TogglyContext.Provider>
      );

      expect(service).toBe(mockTogglyService);
    });

    it('throws error when used outside provider', () => {
      const TestComponent = () => {
        useTogglyService();
        return null;
      };

      const originalError = console.error;
      console.error = jest.fn();

      expect(() => {
        render(<TestComponent />);
      }).toThrow('useTogglyContext must be used within a TogglyProvider');

      console.error = originalError;
    });
  });
});
