<template>
  <slot v-if="shouldShow"></slot>
</template>

<script lang="ts">
// vue-tsc cannot infer Options API `this` on this SFC; runtime and tests cover it.
// @ts-nocheck
import { defineComponent } from 'vue'
import type { TogglyEntityContext } from '@ops-ai/toggly-hooks-types'

export default defineComponent({
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
    },
    context: {
      type: [Object, null],
      default: null
    },
    contextKind: {
      type: String,
      default: undefined
    }
  },

  data() {
    return {
      shouldShow: false,
      isLoading: false,
      _unsubLocalGates: null as (() => void) | null,
      _unsubFeaturesRefresh: null as (() => void) | null
    }
  },

  mounted() {
    this.checkIfShouldShow()
    this._unsubLocalGates = this.$toggly.subscribeLocalGatesChanged(this.checkIfShouldShow)
    this._unsubFeaturesRefresh = this.$toggly.subscribeFeaturesRefresh(this.checkIfShouldShow)
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
    featureKey: 'checkIfShouldShow',
    featureKeys: 'checkIfShouldShow',
    requirement: 'checkIfShouldShow',
    negate: 'checkIfShouldShow',
    context: 'checkIfShouldShow',
    contextKind: 'checkIfShouldShow',
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

      this.shouldShow = gate.length > 0
        ? await this.$toggly.evaluateFeatureGate(
          gate,
          this.requirement,
          this.negate,
          this.context as TogglyEntityContext | Record<string, unknown> | null,
          this.contextKind,
        )
        : true

      this.isLoading = false
    }
  }
})
</script>
