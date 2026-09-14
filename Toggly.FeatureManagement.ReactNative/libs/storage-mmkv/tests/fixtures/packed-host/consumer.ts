import type { TogglyStorage } from '@ops-ai/react-native-toggly-core';
import { createMMKVStorageAdapter } from '@ops-ai/react-native-toggly-storage-mmkv';

const storage: TogglyStorage = createMMKVStorageAdapter({
  id: 'toggly',
  keyPrefix: 'toggly:',
  encrypted: true,
  encryptionKey: '0123456789abcdef',
});

void storage.get('definitions');
