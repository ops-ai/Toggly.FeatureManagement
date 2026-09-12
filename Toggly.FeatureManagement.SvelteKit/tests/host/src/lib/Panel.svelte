<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import {createToggly,type TogglySnapshot} from '@ops-ai/toggly-sveltekit';
 import Feature from '@ops-ai/toggly-sveltekit/Feature.svelte';
 export let snapshot:TogglySnapshot;
 export let baseURI:string;
 let local=true;
 const toggly=createToggly(snapshot,{appKey:'frontend-fixture',baseURI,refreshInterval:200,timeout:2000,onError:()=>{throw Error('host browser observer failed');},localGates:[{id:'local',flagKeys:['on'],isEnabled:()=>local}]});
 $: toggly.update(snapshot);
 $: enabled=$toggly && toggly.isEnabled('on');
 $: vip=$toggly && toggly.isEnabled('Order',{entity:{kind:'Order',key:'1',attributes:{Vip:true}}});
 $: noEntity=$toggly && toggly.isEnabled('Order');
 onMount(()=>{void toggly.start();});
 onDestroy(()=>toggly.dispose());
</script>
<Feature {toggly} feature="on"><p data-testid="on">ON</p><p slot="fallback" data-testid="off">OFF</p></Feature>
<p data-testid="programmatic">{String(enabled)}</p><p data-testid="vip">{String(vip)}</p><p data-testid="no-entity">{String(noEntity)}</p>
<Feature {toggly} feature={['on','off']} options={{requirement:'any'}}><p data-testid="any">ANY</p></Feature>
<Feature {toggly} feature="off" options={{negate:true}}><p data-testid="negate">NEGATED</p></Feature>
<pre data-testid="snapshot">{JSON.stringify($toggly)}</pre>
<button on:click={()=>{local=!local;toggly.notifyLocalGatesChanged();}}>Local prerequisite</button>
