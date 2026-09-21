/** Internal channel names — not part of the public renderer API. */
export const IPC_PREFIX = 'toggly:' as const

export const IPC_CHANNELS = {
  isFeatureOn: `${IPC_PREFIX}isFeatureOn`,
  isFeatureOff: `${IPC_PREFIX}isFeatureOff`,
  evaluateFeatureGate: `${IPC_PREFIX}evaluateFeatureGate`,
  recordUsage: `${IPC_PREFIX}recordUsage`,
  recordView: `${IPC_PREFIX}recordView`,
  incrementCounter: `${IPC_PREFIX}incrementCounter`,
  setGauge: `${IPC_PREFIX}setGauge`,
  flushTelemetry: `${IPC_PREFIX}flushTelemetry`,
  getFlags: `${IPC_PREFIX}getFlags`,
  setContext: `${IPC_PREFIX}setContext`,
  clearContext: `${IPC_PREFIX}clearContext`,
  evaluationsChanged: `${IPC_PREFIX}evaluations-changed`,
  flagsUpdated: `${IPC_PREFIX}flags-updated`,
} as const

export type IpcChannelName = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
