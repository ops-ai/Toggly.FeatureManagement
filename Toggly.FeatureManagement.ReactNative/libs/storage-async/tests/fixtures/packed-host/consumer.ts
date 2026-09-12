import AsyncStorage from '@react-native-async-storage/async-storage'
import { createAsyncStorageAdapter } from '@ops-ai/react-native-toggly-storage-async'
import type { TogglyStorage } from '@ops-ai/react-native-toggly-core'

const storage: TogglyStorage = createAsyncStorageAdapter()
void storage.get('definitions')
void AsyncStorage.getItem('@toggly:definitions')
