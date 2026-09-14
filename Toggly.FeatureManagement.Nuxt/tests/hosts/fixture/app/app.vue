<script setup lang="ts">
const toggly = useToggly()
const { isEnabled } = useFeatureFlag('Enabled')
const { isEnabled: any } = useFeatureGate(['Enabled', 'Disabled'], 'any')
const mounted = ref(false)
const ssrCore = useState<boolean | null>('ssr-core', () => null)
onServerPrefetch(async () => { ssrCore.value = await toggly.client.isFeatureOn('Targeted') })
const initialized = ref(false)
const coreTarget = ref<boolean | null>(null)
const coreGate = ref<boolean | null>(null)
async function updateCoreFlags() {
  coreTarget.value = await toggly.client.isFeatureOn('Targeted')
  coreGate.value = await toggly.client.evaluateFeatureGate(['Targeted', 'Disabled'], 'any')
}
onMounted(async () => { await updateCoreFlags(); mounted.value = true })
async function identifyBob() { await toggly.setIdentity('bob'); await updateCoreFlags() }
async function refresh() { await toggly.refresh(); await updateCoreFlags() }
async function initialize() {
  await toggly.init({ appKey: 'fixture', identity: 'alice', baseUri: location.origin + '/api/definitions', refreshInterval: 0, enableLiveUpdates: false })
  initialized.value = true
}
</script>
<template>
  <main>
    <p id="initialized">{{ initialized }}</p>
    <p id="automatic">{{ toggly.features.value.Automatic }}</p>
    <p id="mounted">{{ mounted }}</p>
    <p id="flag">{{ isEnabled }}</p><p id="any">{{ any }}</p>
    <p id="ssr-core">{{ ssrCore }}</p>
    <p id="core-target">{{ coreTarget }}</p><p id="core-gate">{{ coreGate }}</p>
    <p id="target">{{ toggly.features.value.Targeted }}</p>
    <Feature feature-key="Enabled"><p id="gate">enabled</p></Feature>
    <Feature :feature-keys="['Enabled', 'Disabled']" requirement="all"><p id="all">all</p></Feature>
    <Feature feature-key="Disabled" negate><p id="negated">negated</p></Feature>
    <p v-feature-show="'Enabled'" id="directive">directive</p>
    <button id="init" @click="initialize">initialize</button>
    <button id="identity" @click="identifyBob">bob</button>
    <button id="refresh" @click="refresh">refresh</button>
  </main>
</template>
