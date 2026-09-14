export default defineEventHandler(async event => ({
  enabled: await isEventFeatureOn(event, 'Targeted'),
  off: await isEventFeatureOff(event, 'Disabled'),
  any: await evaluateEventFeatureGate(event, ['Enabled', 'Disabled'], 'any'),
  identity: useServerToggly().identity,
}))
