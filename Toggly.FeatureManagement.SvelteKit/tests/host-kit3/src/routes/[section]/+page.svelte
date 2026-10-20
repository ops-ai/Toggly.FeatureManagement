<script lang="ts">
  import type { PageData, ActionData } from './$types';
  export let data: PageData;
  export let form: ActionData;
</script>

<p data-testid="server-on">{String(data.serverOn)}</p>
<form method="POST" action="?/submit"><button>Submit</button></form>
{#if form}<p>{form.message}</p>{/if}
