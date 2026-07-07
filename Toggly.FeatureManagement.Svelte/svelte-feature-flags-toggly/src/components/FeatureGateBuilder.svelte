<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { getTogglyService, togglyFlagsStore, togglyLocalGatesRevision } from '../stores/toggly.store'
  import type { TogglyService } from '../services/toggly.service'

  export let featureKey: string | undefined = undefined
  export let featureKeys: string[] | undefined = undefined
  export let requirement: 'all' | 'any' = 'all'
  export let negate: boolean = false

  let enabled: boolean = false
  let toggly: TogglyService | null = null
  let unsubscribeFlags: (() => void) | null = null
  let unsubscribeLocalGates: (() => void) | null = null

  async function evaluateFeature() {
    if (!toggly) {
      try {
        toggly = getTogglyService()
      } catch (error) {
        console.error('Toggly FeatureGateBuilder error:', error)
        enabled = false
        return
      }
    }

    const gate: string[] = []

    if (featureKey) {
      gate.push(featureKey)
    }

    if (featureKeys) {
      gate.push(...featureKeys)
    }

    if (gate.length === 0) {
      enabled = !negate
      return
    }

    try {
      enabled = await toggly.evaluateFeatureGate(gate, requirement, negate)
    } catch (error) {
      console.error('Toggly FeatureGateBuilder evaluation error:', error)
      enabled = false
    }
  }

  $: if (toggly || featureKey || featureKeys || requirement || negate) {
    evaluateFeature()
  }

  onMount(() => {
    evaluateFeature()
    unsubscribeFlags = togglyFlagsStore.subscribe(() => {
      evaluateFeature()
    })
    unsubscribeLocalGates = togglyLocalGatesRevision.subscribe(() => {
      evaluateFeature()
    })
  })

  onDestroy(() => {
    unsubscribeFlags?.()
    unsubscribeLocalGates?.()
  })
</script>

<slot {enabled} />
