// Main exports
export * from './services'
export * from './stores'
export * from './components'
export * from './utils'
export type { LocalGate } from '@ops-ai/toggly-local-gates'

// Default export for convenience
export { default as Feature } from './components/Feature.svelte'
export { default as FeatureGateBuilder } from './components/FeatureGateBuilder.svelte'
export { createToggly } from './utils/createToggly'
