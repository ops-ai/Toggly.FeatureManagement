<template>
  <slot :enabled="enabled" />
</template>

<script lang="ts">
export default {
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
  },

  data() {
    return {
      enabled: false,
      _unsubLocalGates: null as (() => void) | null,
      _unsubFeaturesRefresh: null as (() => void) | null,
    }
  },

  mounted() {
    this.evaluateGate()
    this._unsubLocalGates = this.$toggly.subscribeLocalGatesChanged(this.evaluateGate)
    this._unsubFeaturesRefresh = this.$toggly.subscribeFeaturesRefresh(this.evaluateGate)
  },

  beforeUnmount() {
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
  },

  methods: {
    async evaluateGate() {
      const gate: string[] = []

      if (this.featureKey) {
        gate.push(this.featureKey)
      }

      if (this.featureKeys) {
        gate.push(...(this.featureKeys as string[]))
      }

      if (gate.length === 0) {
        this.enabled = !this.negate
        return
      }

      this.enabled = await this.$toggly.evaluateFeatureGate(
        gate,
        this.requirement,
        this.negate,
      )
    },
  },
}
</script>
