<template>
  <slot :enabled="enabled" />
</template>

<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
  inject: ['$toggly'],
  props: {
    featureKey: {
      type: String,
    },
    featureKeys: {
      type: Array,
    },
    requirement: {
      type: String,
      default: 'all',
    },
    negate: {
      type: Boolean,
      default: false,
    },
    context: {
      type: Object,
      default: null,
    },
    contextKind: {
      type: String,
    },
  },

  data() {
    return {
      enabled: false,
      isLoading: false,
      active: true,
      evaluationId: 0,
      ownerGeneration: -1,
      _unsubLocalGates: null as (() => void) | null,
      _unsubFeaturesRefresh: null as (() => void) | null,
    }
  },

  mounted() {
    this.evaluateGate()
    this._unsubLocalGates = this.$toggly.subscribeLocalGatesChanged(() => { void this.evaluateGate() })
    this._unsubFeaturesRefresh = this.$toggly.subscribeFeaturesRefresh(() => { if (!this.isLoading || this.ownerGeneration !== this.$toggly._ownerGeneration) void this.evaluateGate() })
  },

  beforeUnmount() {
    this.active = false
    this.evaluationId++
    if (this._unsubLocalGates) {
      this._unsubLocalGates()
      this._unsubLocalGates = null
    }
    if (this._unsubFeaturesRefresh) {
      this._unsubFeaturesRefresh()
      this._unsubFeaturesRefresh = null
    }
  },

  watch: {
    featureKey: 'evaluateGate',
    featureKeys: 'evaluateGate',
    requirement: 'evaluateGate',
    negate: 'evaluateGate',
    context: 'evaluateGate',
    contextKind: 'evaluateGate',
  },

  methods: {
    async evaluateGate() {
      if (!this.active) return
      const evaluationId = ++this.evaluationId
      this.ownerGeneration = this.$toggly._ownerGeneration
      this.isLoading = true
      const gate: string[] = []

      if (this.featureKey) {
        gate.push(this.featureKey)
      }

      if (this.featureKeys) {
        gate.push(...(this.featureKeys as string[]))
      }

      if (gate.length === 0) {
        this.enabled = !this.negate
        this.isLoading = false
        return
      }

      const enabled = await this.$toggly.evaluateFeatureGate(
        gate,
        this.requirement,
        this.negate,
        this.context,
        this.contextKind,
      )
      if (this.active && evaluationId === this.evaluationId) {
        this.enabled = enabled
        this.isLoading = false
      }
    },
  },
})
</script>
