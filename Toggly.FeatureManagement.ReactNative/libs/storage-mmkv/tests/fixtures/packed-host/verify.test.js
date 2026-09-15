const mockMMKV = jest.fn().mockImplementation(() => ({
  getString: jest.fn(() => undefined),
  set: jest.fn(),
  delete: jest.fn(),
  getAllKeys: jest.fn(() => []),
  contains: jest.fn(() => false),
}));

jest.mock('react-native-mmkv', () => ({ MMKV: mockMMKV }));

const { createMMKVStorageAdapter } = require('@ops-ai/react-native-toggly-storage-mmkv');

test('uses the retained constructor and delete APIs', async () => {
  const storage = createMMKVStorageAdapter({
    encrypted: true,
    encryptionKey: '0123456789abcdef',
  });

  await storage.set('definitions', '{}');
  await storage.delete('definitions');

  expect(mockMMKV).toHaveBeenCalledWith({
    id: 'toggly',
    encryptionKey: '0123456789abcdef',
  });
  const instance = mockMMKV.mock.results[0].value;
  expect(instance.set).toHaveBeenCalledWith('toggly:definitions', '{}');
  expect(instance.delete).toHaveBeenCalledWith('toggly:definitions');
});
