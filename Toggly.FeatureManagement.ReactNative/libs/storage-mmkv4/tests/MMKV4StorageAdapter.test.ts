const mockCreateMMKV = jest.fn();

jest.mock('react-native-mmkv', () => ({
  createMMKV: (...args: unknown[]) => mockCreateMMKV(...args),
}));

import {
  createMMKV4StorageAdapter,
  MMKV4StorageAdapter,
} from '../src/index';

function createStorage() {
  return {
    getString: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
    getAllKeys: jest.fn(() => []),
    contains: jest.fn(),
  };
}

describe('MMKV4StorageAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCreateMMKV.mockReturnValue(createStorage());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('preserves the MMKV 2/3 default instance ID and Toggly key prefix', async () => {
    const adapter = new MMKV4StorageAdapter();
    const storage = mockCreateMMKV.mock.results[0].value;

    await adapter.set('definitions', '{"feature-a":true}');
    await expect(adapter.get('definitions')).resolves.toBeNull();

    expect(mockCreateMMKV).toHaveBeenCalledWith({ id: 'toggly' });
    expect(storage.set).toHaveBeenCalledWith('toggly:definitions', '{"feature-a":true}');
    expect(storage.getString).toHaveBeenCalledWith('toggly:definitions');
  });

  it('preserves encryption and path options when creating a native store', () => {
    new MMKV4StorageAdapter({
      encrypted: true,
      encryptionKey: '0123456789abcdef',
      path: '/shared/mmkv',
    });

    expect(mockCreateMMKV).toHaveBeenCalledWith({
      id: 'toggly',
      encryptionKey: '0123456789abcdef',
      path: '/shared/mmkv',
    });
  });

  it('requires an encryption key when encryption is enabled', () => {
    expect(() => new MMKV4StorageAdapter({ encrypted: true })).toThrow(
      '[Toggly] encryptionKey is required when encrypted is true'
    );
  });

  it('uses the MMKV 4 remove API while retaining logical Toggly keys', async () => {
    const storage = createStorage();
    const adapter = new MMKV4StorageAdapter({ mmkv: storage as never });

    await adapter.set('flags', '{"enabled":true}');
    await adapter.delete('flags');

    expect(storage.set).toHaveBeenCalledWith('toggly:flags', '{"enabled":true}');
    expect(storage.remove).toHaveBeenCalledWith('toggly:flags');
  });

  it('clears only Toggly-prefixed keys and exposes logical keys', async () => {
    const storage = createStorage();
    storage.getAllKeys.mockReturnValue(['toggly:definitions', 'toggly:identity', 'host:data']);
    const adapter = new MMKV4StorageAdapter({ mmkv: storage as never });

    await adapter.clear();

    await expect(adapter.keys()).resolves.toEqual(['definitions', 'identity']);
    expect(storage.remove).toHaveBeenCalledWith('toggly:definitions');
    expect(storage.remove).toHaveBeenCalledWith('toggly:identity');
    expect(storage.remove).not.toHaveBeenCalledWith('host:data');
  });

  it('supports custom prefixes and exposes the injected MMKV 4 instance', () => {
    const storage = createStorage();
    storage.contains.mockReturnValue(true);
    const adapter = new MMKV4StorageAdapter({
      keyPrefix: 'application:toggly:',
      mmkv: storage as never,
    });

    expect(adapter.contains('flags')).toBe(true);
    expect(storage.contains).toHaveBeenCalledWith('application:toggly:flags');
    expect(adapter.getMMKVInstance()).toBe(storage);
  });

  it('propagates native storage failures', async () => {
    const storage = createStorage();
    storage.getString.mockImplementation(() => {
      throw new Error('native read failed');
    });
    const adapter = new MMKV4StorageAdapter({ mmkv: storage as never });

    await expect(adapter.get('definitions')).rejects.toThrow('native read failed');
  });

  it('propagates write, remove, clear, and key-listing failures', async () => {
    const storage = createStorage();
    const adapter = new MMKV4StorageAdapter({ mmkv: storage as never });

    storage.set.mockImplementationOnce(() => {
      throw new Error('native write failed');
    });
    await expect(adapter.set('definitions', '{}')).rejects.toThrow('native write failed');

    storage.remove.mockImplementationOnce(() => {
      throw new Error('native remove failed');
    });
    await expect(adapter.delete('definitions')).rejects.toThrow('native remove failed');

    storage.getAllKeys.mockImplementationOnce(() => {
      throw new Error('native clear failed');
    });
    await expect(adapter.clear()).rejects.toThrow('native clear failed');

    storage.getAllKeys.mockImplementationOnce(() => {
      throw new Error('native keys failed');
    });
    await expect(adapter.keys()).rejects.toThrow('native keys failed');
  });

  it('creates an MMKV 4 adapter through the factory', () => {
    expect(createMMKV4StorageAdapter()).toBeInstanceOf(MMKV4StorageAdapter);
  });
});
