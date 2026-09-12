export {
  ElectronTogglyClient,
  initToggly,
  getToggly,
  isFeatureOn,
  isFeatureOff,
  evaluateFeatureGate,
  setContext,
  clearContext,
  addHook,
  closeToggly,
  __resetTogglyForTests,
} from './client.js'
export { registerTogglyIpc } from './ipc.js'
export { DiskFeatureCache, buildCacheFilePath } from './cache.js'
export type { DiskCacheEntry } from './cache.js'
export type {
  TogglyElectronConfig,
  SetContextInput,
  FeatureFlagsSnapshot,
  FeatureRequirement,
  EntityContextInput,
  Hook,
} from '../types.js'
export { IPC_CHANNELS, IPC_PREFIX } from '../ipc-channels.js'
export { SDK_ID, SDK_VERSION } from '../sdk-identity.js'
