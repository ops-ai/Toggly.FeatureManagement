import { createApp, h } from 'vue';
import { toggly } from '@ops-ai/vue-feature-flags-toggly';

const app = createApp({ render: () => h('main', 'Vue 3.2 packed host') });
app.use(toggly, { featureDefaults: { release: true } });
app.mount('#app');
