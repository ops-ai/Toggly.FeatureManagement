const mockAsyncStorage = {
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  getAllKeys: jest.fn(() => Promise.resolve([])),
  multiRemove: jest.fn(() => Promise.resolve()),
}

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: mockAsyncStorage,
}))

const { createAsyncStorageAdapter } = require('@ops-ai/react-native-toggly-storage-async')

test('uses the retained default AsyncStorage singleton API', async () => {
  const storage = createAsyncStorageAdapter()
  await storage.set('definitions', '{}')
  await storage.delete('definitions')

  expect(mockAsyncStorage.setItem).toHaveBeenCalledWith('@toggly:definitions', '{}')
  expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('@toggly:definitions')
})

require('./telemetry-consumer.cjs')(() => createAsyncStorageAdapter());
