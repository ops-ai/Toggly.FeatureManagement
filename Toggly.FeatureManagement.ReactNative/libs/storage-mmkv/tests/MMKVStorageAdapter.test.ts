// Create mock functions that will be used by the mock
const mockGetString = jest.fn();
const mockSet = jest.fn();
const mockDelete = jest.fn();
const mockGetAllKeys = jest.fn();
const mockContains = jest.fn();

// Store MMKV constructor calls for inspection
const mmkvConstructorCalls: any[] = [];

// Mock MMKV module
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation((options: any) => {
    mmkvConstructorCalls.push(options);
    return {
      getString: (...args: any[]) => mockGetString(...args),
      set: (...args: any[]) => mockSet(...args),
      delete: (...args: any[]) => mockDelete(...args),
      getAllKeys: (...args: any[]) => mockGetAllKeys(...args),
      contains: (...args: any[]) => mockContains(...args),
    };
  }),
}));

import { MMKVStorageAdapter, createMMKVStorageAdapter } from '../src/index';
import { MMKV } from 'react-native-mmkv';

describe('MMKVStorageAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mmkvConstructorCalls.length = 0;
    mockGetString.mockReset();
    mockSet.mockReset();
    mockDelete.mockReset();
    mockGetAllKeys.mockReset();
    mockContains.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore();
  });

  describe('constructor', () => {
    it('creates MMKV instance with default options', () => {
      new MMKVStorageAdapter();

      expect(MMKV).toHaveBeenCalledWith({ id: 'toggly' });
    });

    it('creates MMKV instance with custom id', () => {
      new MMKVStorageAdapter({ id: 'custom-id' });

      expect(MMKV).toHaveBeenCalledWith({ id: 'custom-id' });
    });

    it('creates MMKV instance with encryption', () => {
      new MMKVStorageAdapter({
        encrypted: true,
        encryptionKey: 'secret-key',
      });

      expect(MMKV).toHaveBeenCalledWith({
        id: 'toggly',
        encryptionKey: 'secret-key',
      });
    });

    it('throws error when encrypted is true but no encryptionKey', () => {
      expect(() => {
        new MMKVStorageAdapter({ encrypted: true });
      }).toThrow('[Toggly] encryptionKey is required when encrypted is true');
    });

    it('creates MMKV instance with custom path', () => {
      new MMKVStorageAdapter({ path: '/custom/path' });

      expect(MMKV).toHaveBeenCalledWith({
        id: 'toggly',
        path: '/custom/path',
      });
    });

    it('creates MMKV instance with all options', () => {
      new MMKVStorageAdapter({
        id: 'custom-id',
        encrypted: true,
        encryptionKey: 'secret-key',
        path: '/custom/path',
      });

      expect(MMKV).toHaveBeenCalledWith({
        id: 'custom-id',
        encryptionKey: 'secret-key',
        path: '/custom/path',
      });
    });
  });

  describe('get', () => {
    it('retrieves value from MMKV with prefixed key', async () => {
      mockGetString.mockReturnValue('test-value');

      const adapter = new MMKVStorageAdapter();
      const result = await adapter.get('testKey');

      expect(mockGetString).toHaveBeenCalledWith('toggly:testKey');
      expect(result).toBe('test-value');
    });

    it('returns null when value not found', async () => {
      mockGetString.mockReturnValue(undefined);

      const adapter = new MMKVStorageAdapter();
      const result = await adapter.get('nonexistent');

      expect(result).toBeNull();
    });

    it('returns null and logs error on failure', async () => {
      mockGetString.mockImplementation(() => {
        throw new Error('MMKV error');
      });

      const adapter = new MMKVStorageAdapter();
      const result = await adapter.get('testKey');

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        '[Toggly] MMKV get error:',
        expect.any(Error)
      );
    });

    it('uses custom prefix for get', async () => {
      mockGetString.mockReturnValue('value');

      const adapter = new MMKVStorageAdapter({ keyPrefix: 'custom:' });
      await adapter.get('feature');

      expect(mockGetString).toHaveBeenCalledWith('custom:feature');
    });
  });

  describe('set', () => {
    it('stores value in MMKV with prefixed key', async () => {
      const adapter = new MMKVStorageAdapter();
      await adapter.set('testKey', 'test-value');

      expect(mockSet).toHaveBeenCalledWith('toggly:testKey', 'test-value');
    });

    it('logs error on failure', async () => {
      mockSet.mockImplementation(() => {
        throw new Error('MMKV error');
      });

      const adapter = new MMKVStorageAdapter();
      await adapter.set('testKey', 'value');

      expect(console.error).toHaveBeenCalledWith(
        '[Toggly] MMKV set error:',
        expect.any(Error)
      );
    });
  });

  describe('delete', () => {
    it('removes value from MMKV with prefixed key', async () => {
      const adapter = new MMKVStorageAdapter();
      await adapter.delete('testKey');

      expect(mockDelete).toHaveBeenCalledWith('toggly:testKey');
    });

    it('logs error on failure', async () => {
      mockDelete.mockImplementation(() => {
        throw new Error('MMKV error');
      });

      const adapter = new MMKVStorageAdapter();
      await adapter.delete('testKey');

      expect(console.error).toHaveBeenCalledWith(
        '[Toggly] MMKV delete error:',
        expect.any(Error)
      );
    });
  });

  describe('clear', () => {
    it('removes only keys with matching prefix', async () => {
      mockGetAllKeys.mockReturnValue([
        'toggly:feature1',
        'toggly:feature2',
        'other:data',
      ]);

      const adapter = new MMKVStorageAdapter();
      await adapter.clear();

      expect(mockDelete).toHaveBeenCalledTimes(2);
      expect(mockDelete).toHaveBeenCalledWith('toggly:feature1');
      expect(mockDelete).toHaveBeenCalledWith('toggly:feature2');
    });

    it('handles empty storage', async () => {
      mockGetAllKeys.mockReturnValue([]);

      const adapter = new MMKVStorageAdapter();
      await adapter.clear();

      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('logs error on failure', async () => {
      mockGetAllKeys.mockImplementation(() => {
        throw new Error('MMKV error');
      });

      const adapter = new MMKVStorageAdapter();
      await adapter.clear();

      expect(console.error).toHaveBeenCalledWith(
        '[Toggly] MMKV clear error:',
        expect.any(Error)
      );
    });
  });

  describe('keys', () => {
    it('returns keys without prefix', async () => {
      mockGetAllKeys.mockReturnValue([
        'toggly:feature1',
        'toggly:feature2',
        'other:data',
      ]);

      const adapter = new MMKVStorageAdapter();
      const result = await adapter.keys();

      expect(result).toEqual(['feature1', 'feature2']);
    });

    it('returns empty array when no keys', async () => {
      mockGetAllKeys.mockReturnValue([]);

      const adapter = new MMKVStorageAdapter();
      const result = await adapter.keys();

      expect(result).toEqual([]);
    });

    it('returns empty array and logs error on failure', async () => {
      mockGetAllKeys.mockImplementation(() => {
        throw new Error('MMKV error');
      });

      const adapter = new MMKVStorageAdapter();
      const result = await adapter.keys();

      expect(result).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(
        '[Toggly] MMKV keys error:',
        expect.any(Error)
      );
    });
  });

  describe('contains', () => {
    it('checks if key exists with prefix', () => {
      mockContains.mockReturnValue(true);

      const adapter = new MMKVStorageAdapter();
      const result = adapter.contains('testKey');

      expect(mockContains).toHaveBeenCalledWith('toggly:testKey');
      expect(result).toBe(true);
    });

    it('returns false when key does not exist', () => {
      mockContains.mockReturnValue(false);

      const adapter = new MMKVStorageAdapter();
      const result = adapter.contains('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('getMMKVInstance', () => {
    it('returns the underlying MMKV instance', () => {
      const adapter = new MMKVStorageAdapter();
      const instance = adapter.getMMKVInstance();

      expect(instance).toBeDefined();
      expect(instance.getString).toBeDefined();
      expect(instance.set).toBeDefined();
    });
  });
});

describe('createMMKVStorageAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates adapter with default options', () => {
    const adapter = createMMKVStorageAdapter();
    expect(adapter).toBeInstanceOf(MMKVStorageAdapter);
  });

  it('creates adapter with custom options', () => {
    const adapter = createMMKVStorageAdapter({ keyPrefix: 'custom:' });
    expect(adapter).toBeInstanceOf(MMKVStorageAdapter);
  });
});
