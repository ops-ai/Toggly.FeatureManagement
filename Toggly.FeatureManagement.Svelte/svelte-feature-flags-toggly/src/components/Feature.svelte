<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { getTogglyService, togglyFlagsStore, togglyLocalGatesRevision } from '../stores/toggly.store'
  import type { TogglyService } from '../services/toggly.service'
  import type { TogglyEntityContext } from '@ops-ai/toggly-hooks-types'

  export let featureKey: string | undefined = undefined
  export let featureKeys: string[] | undefined = undefined
  export let requirement: 'all' | 'any' = 'all'
  export let negate: boolean = false
  /** Entity instance or canonical entity context for entity-gated flags */
  export let context: TogglyEntityContext | Record<string, unknown> | null = null
  /** Context kind for registerContext mapper lookup when `context` is a domain object */
  export let contextKind: string | undefined = undefined

  let shouldShow: boolean = false
  let toggly: TogglyService | null = null
  let unsubscribeFlags: (() => void) | null = null
  let unsubscribeLocalGates: (() => void) | null = null

  async function evaluateFeature() {
    if (!toggly) {
      try {
        toggly = getTogglyService()
      } catch (error) {
        console.error('Toggly Feature component error:', error)
        shouldShow = false
        return
      }
    }

    // Check if we should show the feature during evaluation
    shouldShow = toggly.shouldShowFeatureDuringEvaluation

    const gate: string[] = []

    if (featureKey) {
      gate.push(featureKey)
    }

    if (featureKeys) {
      gate.push(...featureKeys)
    }

    if (gate.length > 0 && toggly) {
      try {
        shouldShow = await toggly.evaluateFeatureGate(
          gate,
          requirement,
          negate,
          context,
          contextKind,
        )
      } catch (error) {
        console.error('Toggly Feature evaluation error:', error)
        shouldShow = false
      }
    } else {
      shouldShow = !negate
    }
  }

  // Reactive statement to re-evaluate when props change
  $: if (toggly || featureKey || featureKeys || requirement || negate || context || contextKind) {
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

{#if shouldShow}
  <slot />
{/if}
