<script lang="ts">
  import Panel from '$lib/Panel.svelte';
  import type { LayoutData } from './$types';
  export let data: LayoutData;
  let mounted = true;
</script>

<a href="/one?user=alice">Alice</a><a href="/two?user=bob">Bob</a>
<a href="/one?user=alice&instance=token-a">Minted Alice</a>
<a href="/two?user=bob&instance=token-b">Minted Bob</a>
<button on:click={() => (mounted = !mounted)}>Toggle owner</button>
{#if mounted}<Panel
    snapshot={data.snapshot}
    baseURI={data.baseURI}
    frontendKey={data.frontendKey}
    telemetryEnabled={data.telemetryEnabled}
  />{/if}
<slot />
