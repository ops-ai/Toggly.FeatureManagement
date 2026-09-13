<script lang="ts">
  import Panel from '$lib/Panel.svelte';
  import type { LayoutData } from './$types';
  export let data: LayoutData;
  let mounted = true;
</script>

<a href="/one?user=alice">Alice</a><a href="/two?user=bob">Bob</a>
<button on:click={() => (mounted = !mounted)}>Toggle owner</button>
{#if mounted}<Panel snapshot={data.snapshot} baseURI={data.baseURI} />{/if}
<slot />
