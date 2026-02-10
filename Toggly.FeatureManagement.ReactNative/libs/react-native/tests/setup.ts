// Jest setup file for React Native tests

// Mock React Native modules
jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({
      remove: jest.fn(),
    })),
  },
  View: 'View',
  Text: 'Text',
  StyleSheet: {
    create: jest.fn((styles) => styles),
  },
  Platform: {
    OS: 'ios',
    select: jest.fn((obj) => obj.ios || obj.default),
  },
}));

// Mock fetch
global.fetch = jest.fn();

// Mock crypto
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      digest: jest.fn().mockImplementation(async (_algorithm: string, data: ArrayBuffer) => {
        const view = new Uint8Array(data);
        let hash = 0;
        for (let i = 0; i < view.length; i++) {
          hash = ((hash << 5) - hash + view[i]) | 0;
        }
        const result = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
          result[i] = (hash >> (i % 4) * 8) & 0xff;
        }
        return result.buffer;
      }),
    },
    getRandomValues: jest.fn().mockImplementation((array: Uint8Array) => {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    }),
  },
});

// Mock TextEncoder if not available
if (typeof TextEncoder === 'undefined') {
  global.TextEncoder = class TextEncoder {
    encode(input: string): Uint8Array {
      const bytes: number[] = [];
      for (let i = 0; i < input.length; i++) {
        bytes.push(input.charCodeAt(i) & 0xff);
      }
      return new Uint8Array(bytes);
    }
  } as unknown as typeof TextEncoder;
}

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
