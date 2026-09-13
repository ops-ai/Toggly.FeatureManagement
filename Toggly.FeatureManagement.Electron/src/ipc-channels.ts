/** Internal channel names — not part of the public renderer API. */
export const IPC_PREFIX = 'toggly:' as const

export const IPC_CHANNELS = {
  isFeatureOn: `${IPC_PREFIX}isFeatureOn`,
  isFeatureOff: `${IPC_PREFIX}isFeatureOff`,
  evaluateFeatureGate: `${IPC_PREFIX}evaluateFeatureGate`,
  getFlags: `${IPC_PREFIX}getFlags`,
  setContext: `${IPC_PREFIX}setContext`,
  clearContext: `${IPC_PREFIX}clearContext`,
  flagsUpdated: `${IPC_PREFIX}flags-updated`,
} as const

export type IpcChannelName = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
