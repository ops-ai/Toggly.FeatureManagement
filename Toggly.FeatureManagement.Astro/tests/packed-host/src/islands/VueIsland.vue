<script setup lang="ts">
import { useFeatureFlag } from '@ops-ai/astro-feature-flags-toggly/vue';
import FeatureGateBuilder from '@ops-ai/astro-feature-flags-toggly/vue/FeatureGateBuilder.vue';
import Feature from '@ops-ai/astro-feature-flags-toggly/vue/Feature.vue';
const { enabled, isReady } = useFeatureFlag('Visible');
</script>
<template><section><output id="vue-state">{{ isReady ? String(enabled) : 'loading' }}</output>
<Feature flag="Visible"><span id="vue-content">vue-enabled</span></Feature><FeatureGateBuilder flag="Visible" v-slot="{ enabled }"><output id="vue-builder">{{ String(enabled) }}</output></FeatureGateBuilder></section></template>
