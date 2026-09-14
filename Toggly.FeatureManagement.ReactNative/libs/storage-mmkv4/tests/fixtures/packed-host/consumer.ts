import type { TogglyStorage } from '@ops-ai/react-native-toggly-core';
import { createMMKV4StorageAdapter } from '@ops-ai/react-native-toggly-storage-mmkv4';

const storage: TogglyStorage = createMMKV4StorageAdapter({
  id: 'toggly',
  keyPrefix: 'toggly:',
  encrypted: true,
  encryptionKey: '0123456789abcdef',
});

void storage.get('definitions');
