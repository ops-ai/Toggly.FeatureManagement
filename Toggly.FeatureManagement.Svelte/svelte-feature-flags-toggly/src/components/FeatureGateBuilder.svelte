<script lang="ts">
  import { onMount } from 'svelte'
  import { togglyServiceStore, togglyFlagsStore, togglyLocalGatesRevision } from '../stores/toggly.store'
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

  let enabled: boolean = false
  let toggly: TogglyService | null = null
  let alive = true
  let generation = 0
  let scheduled = false

  async function evaluateFeature() {
    const owner = toggly
    const current = generation
    if (!owner) { enabled = false; return }

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
      const result = await owner.evaluateFeatureGate(
        gate,
        requirement,
        negate,
        context,
        contextKind,
      )
      if (alive && generation === current && toggly === owner) enabled = result
    } catch (error) {
      if (alive && generation === current && toggly === owner) {
        console.error('Toggly FeatureGateBuilder evaluation error:', error)
        enabled = false
      }
    }
  }

  function scheduleEvaluation() {
    generation++
    if (scheduled) return
    scheduled = true
    Promise.resolve().then(() => {
      scheduled = false
      if (alive) void evaluateFeature()
    })
  }

  $: if (featureKey || featureKeys || requirement || negate || context || contextKind) {
    scheduleEvaluation()
  }

  onMount(() => {
    const unsubscribers = [
      togglyServiceStore.subscribe(service => { toggly = service; scheduleEvaluation() }),
      togglyFlagsStore.subscribe(scheduleEvaluation),
      togglyLocalGatesRevision.subscribe(scheduleEvaluation),
    ]
    return () => {
      alive = false
      generation++
      unsubscribers.forEach(unsubscribe => unsubscribe())
    }
  })
</script>

<slot {enabled} />
