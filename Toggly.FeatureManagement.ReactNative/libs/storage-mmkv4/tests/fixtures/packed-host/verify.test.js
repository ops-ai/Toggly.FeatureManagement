const mockCreateMMKV = jest.fn(() => ({
  getString: jest.fn(() => undefined),
  set: jest.fn(),
  remove: jest.fn(),
  getAllKeys: jest.fn(() => []),
  contains: jest.fn(() => false),
}));

jest.mock('react-native-mmkv', () => ({ createMMKV: mockCreateMMKV }));

const { createMMKV4StorageAdapter } = require('@ops-ai/react-native-toggly-storage-mmkv4');

test('uses the MMKV 4 factory and remove API', async () => {
  const storage = createMMKV4StorageAdapter({
    encrypted: true,
    encryptionKey: '0123456789abcdef',
  });

  await storage.set('definitions', '{}');
  await storage.delete('definitions');

  expect(mockCreateMMKV).toHaveBeenCalledWith({
    id: 'toggly',
    encryptionKey: '0123456789abcdef',
  });
  const instance = mockCreateMMKV.mock.results[0].value;
  expect(instance.set).toHaveBeenCalledWith('toggly:definitions', '{}');
  expect(instance.remove).toHaveBeenCalledWith('toggly:definitions');
});
