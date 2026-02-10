// Create mock functions that will be used by the mock
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
const mockRemoveItem = jest.fn();
const mockGetAllKeys = jest.fn();
const mockMultiRemove = jest.fn();

// Mock AsyncStorage module with the mock functions
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (...args: any[]) => mockGetItem(...args),
    setItem: (...args: any[]) => mockSetItem(...args),
    removeItem: (...args: any[]) => mockRemoveItem(...args),
    getAllKeys: (...args: any[]) => mockGetAllKeys(...args),
    multiRemove: (...args: any[]) => mockMultiRemove(...args),
  },
}));

import { AsyncStorageAdapter, createAsyncStorageAdapter } from '../src/index';

describe('AsyncStorageAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockReset();
    mockSetItem.mockReset();
    mockRemoveItem.mockReset();
    mockGetAllKeys.mockReset();
    mockMultiRemove.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore();
  });

  describe('constructor', () => {
    it('uses default key prefix', () => {
      const adapter = new AsyncStorageAdapter();
      expect(adapter).toBeDefined();
    });

    it('uses custom key prefix', () => {
      const adapter = new AsyncStorageAdapter({ keyPrefix: '@custom:' });
      expect(adapter).toBeDefined();
    });
  });

  describe('get', () => {
    it('retrieves value from AsyncStorage with prefixed key', async () => {
      mockGetItem.mockResolvedValue('test-value');

      const adapter = new AsyncStorageAdapter();
      const result = await adapter.get('testKey');

      expect(mockGetItem).toHaveBeenCalledWith('@toggly:testKey');
      expect(result).toBe('test-value');
    });

    it('returns null when value not found', async () => {
      mockGetItem.mockResolvedValue(null);

      const adapter = new AsyncStorageAdapter();
      const result = await adapter.get('nonexistent');

      expect(result).toBeNull();
    });

    it('returns null and logs error on failure', async () => {
      mockGetItem.mockRejectedValue(new Error('Storage error'));

      const adapter = new AsyncStorageAdapter();
      const result = await adapter.get('testKey');

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        '[Toggly] AsyncStorage get error:',
        expect.any(Error)
      );
    });

    it('uses custom prefix for get', async () => {
      mockGetItem.mockResolvedValue('value');

      const adapter = new AsyncStorageAdapter({ keyPrefix: '@myapp:' });
      await adapter.get('feature');

      expect(mockGetItem).toHaveBeenCalledWith('@myapp:feature');
    });
  });

  describe('set', () => {
    it('stores value in AsyncStorage with prefixed key', async () => {
      mockSetItem.mockResolvedValue(undefined);

      const adapter = new AsyncStorageAdapter();
      await adapter.set('testKey', 'test-value');

      expect(mockSetItem).toHaveBeenCalledWith('@toggly:testKey', 'test-value');
    });

    it('logs error on failure', async () => {
      mockSetItem.mockRejectedValue(new Error('Storage error'));

      const adapter = new AsyncStorageAdapter();
      await adapter.set('testKey', 'value');

      expect(console.error).toHaveBeenCalledWith(
        '[Toggly] AsyncStorage set error:',
        expect.any(Error)
      );
    });
  });

  describe('delete', () => {
    it('removes value from AsyncStorage with prefixed key', async () => {
      mockRemoveItem.mockResolvedValue(undefined);

      const adapter = new AsyncStorageAdapter();
      await adapter.delete('testKey');

      expect(mockRemoveItem).toHaveBeenCalledWith('@toggly:testKey');
    });

    it('logs error on failure', async () => {
      mockRemoveItem.mockRejectedValue(new Error('Storage error'));

      const adapter = new AsyncStorageAdapter();
      await adapter.delete('testKey');

      expect(console.error).toHaveBeenCalledWith(
        '[Toggly] AsyncStorage delete error:',
        expect.any(Error)
      );
    });
  });

  describe('clear', () => {
    it('removes only keys with matching prefix', async () => {
      mockGetAllKeys.mockResolvedValue([
        '@toggly:feature1',
        '@toggly:feature2',
        '@other:data',
      ]);
      mockMultiRemove.mockResolvedValue(undefined);

      const adapter = new AsyncStorageAdapter();
      await adapter.clear();

      expect(mockMultiRemove).toHaveBeenCalledWith([
        '@toggly:feature1',
        '@toggly:feature2',
      ]);
    });

    it('handles empty storage', async () => {
      mockGetAllKeys.mockResolvedValue([]);
      mockMultiRemove.mockResolvedValue(undefined);

      const adapter = new AsyncStorageAdapter();
      await adapter.clear();

      expect(mockMultiRemove).toHaveBeenCalledWith([]);
    });

    it('logs error on failure', async () => {
      mockGetAllKeys.mockRejectedValue(new Error('Storage error'));

      const adapter = new AsyncStorageAdapter();
      await adapter.clear();

      expect(console.error).toHaveBeenCalledWith(
        '[Toggly] AsyncStorage clear error:',
        expect.any(Error)
      );
    });
  });

  describe('keys', () => {
    it('returns keys without prefix', async () => {
      mockGetAllKeys.mockResolvedValue([
        '@toggly:feature1',
        '@toggly:feature2',
        '@other:data',
      ]);

      const adapter = new AsyncStorageAdapter();
      const result = await adapter.keys();

      expect(result).toEqual(['feature1', 'feature2']);
    });

    it('returns empty array when no keys', async () => {
      mockGetAllKeys.mockResolvedValue([]);

      const adapter = new AsyncStorageAdapter();
      const result = await adapter.keys();

      expect(result).toEqual([]);
    });

    it('returns empty array and logs error on failure', async () => {
      mockGetAllKeys.mockRejectedValue(new Error('Storage error'));

      const adapter = new AsyncStorageAdapter();
      const result = await adapter.keys();

      expect(result).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(
        '[Toggly] AsyncStorage keys error:',
        expect.any(Error)
      );
    });
  });
});

describe('createAsyncStorageAdapter', () => {
  it('creates adapter with default options', () => {
    const adapter = createAsyncStorageAdapter();
    expect(adapter).toBeInstanceOf(AsyncStorageAdapter);
  });

  it('creates adapter with custom options', () => {
    const adapter = createAsyncStorageAdapter({ keyPrefix: '@custom:' });
    expect(adapter).toBeInstanceOf(AsyncStorageAdapter);
  });
});
