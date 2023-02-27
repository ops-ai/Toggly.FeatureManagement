<template>
  <div v-if="shouldShow">
    <slot></slot>
  </div>
</template>

<script lang="ts">
export default {
  inject: ['$toggly'],
  props: {
    featureKey: {
      type: String
    },
    featureKeys: {
      type: Array
    },
    requirement: {
      type: String,
      default: 'all'
    },
    negate: {
      type: Boolean,
      default: false
    }
  },

  data() {
    return {
      shouldShow: false,
      isLoading: false
    }
  },

  mounted() {
    this.checkIfShouldShow()
  },

  methods: {
    async checkIfShouldShow() {
      this.isLoading = true

      // Check if we should show the feature during the evaluation of a feature flag
      this.shouldShow = this.$toggly.shouldShowFeatureDuringEvaluation

      var gate: string[] = []

      if (this.featureKey) {
        gate.push(this.featureKey)
      }

      if (this.featureKeys) {
        gate = gate.concat(this.featureKeys as string[])
      }

      this.shouldShow = gate.length > 0 ? await this.$toggly.evaluateFeatureGate(gate, this.requirement, this.negate) : true

      this.isLoading = false
    }
  }
}
</script>