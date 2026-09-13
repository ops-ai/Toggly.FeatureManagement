<script lang="ts">
  import { createToggly, Feature } from '@ops-ai/svelte-feature-flags-toggly';

  void createToggly({ featureDefaults: { release: true } });
</script>

<Feature featureKey="release">Svelte 4 packed host</Feature>
