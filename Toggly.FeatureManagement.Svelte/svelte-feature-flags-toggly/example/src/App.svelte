<script lang="ts">
  import { onMount } from 'svelte'
  import { 
    Feature, 
    createToggly, 
    isFeatureOn, 
    isFeatureOff,
    evaluateFeatureGate,
    createFeatureStore
  } from '@ops-ai/svelte-feature-flags-toggly'

  let initialized = false
  let feature1Status = false
  let feature2Status = false
  let gateResult = false

  // Example: Using reactive store
  const reactiveFeature = createFeatureStore('firstFeature')

  onMount(async () => {
    // Initialize with feature defaults (for demo purposes)
    // In production, use your actual appKey and environment
    await createToggly({
      appKey: 'your-app-key', // Replace with your actual app key
      environment: 'Production', // Replace with your environment
      // Or use featureDefaults for offline demo:
      featureDefaults: {
        firstFeature: true,
        secondFeature: false,
        thirdFeature: true,
      },
    })
    initialized = true
  })

  async function checkFeature1() {
    feature1Status = await isFeatureOn('firstFeature')
  }

  async function checkFeature2() {
    feature2Status = await isFeatureOff('secondFeature')
  }

  async function checkGate() {
    gateResult = await evaluateFeatureGate(['firstFeature', 'thirdFeature'], 'all', false)
  }
</script>

<main>
  <h1>Toggly Svelte Example</h1>

  {#if !initialized}
    <p>Initializing Toggly...</p>
  {:else}
    <div class="card">
      <h2>Feature Component Examples</h2>
      
      <h3>Single Feature (firstFeature = true)</h3>
      <Feature featureKey="firstFeature">
        <p class="feature-enabled">✅ This content is shown because firstFeature is enabled</p>
      </Feature>

      <h3>Single Feature (secondFeature = false)</h3>
      <Feature featureKey="secondFeature">
        <p class="feature-enabled">This should not be visible</p>
      </Feature>
      <p class="feature-disabled">❌ Content hidden because secondFeature is disabled</p>

      <h3>Multiple Features - ALL requirement</h3>
      <Feature featureKeys={['firstFeature', 'thirdFeature']} requirement="all">
        <p class="feature-enabled">✅ Both firstFeature and thirdFeature are enabled</p>
      </Feature>

      <h3>Multiple Features - ANY requirement</h3>
      <Feature featureKeys={['firstFeature', 'secondFeature']} requirement="any">
        <p class="feature-enabled">✅ At least one feature is enabled</p>
      </Feature>

      <h3>Negated Feature</h3>
      <Feature featureKey="secondFeature" negate={true}>
        <p class="feature-enabled">✅ This shows because secondFeature is disabled (negated)</p>
      </Feature>
    </div>

    <div class="card">
      <h2>Programmatic Checks</h2>
      
      <div>
        <button on:click={checkFeature1}>Check firstFeature</button>
        {#if feature1Status !== undefined}
          <p>
            firstFeature status: 
            <span class={feature1Status ? 'feature-enabled' : 'feature-disabled'}>
              {feature1Status ? 'ENABLED' : 'DISABLED'}
            </span>
          </p>
        {/if}
      </div>

      <div>
        <button on:click={checkFeature2}>Check if secondFeature is OFF</button>
        {#if feature2Status !== undefined}
          <p>
            secondFeature is OFF: 
            <span class={feature2Status ? 'feature-enabled' : 'feature-disabled'}>
              {feature2Status ? 'YES' : 'NO'}
            </span>
          </p>
        {/if}
      </div>

      <div>
        <button on:click={checkGate}>Check Gate (firstFeature AND thirdFeature)</button>
        {#if gateResult !== undefined}
          <p>
            Gate result: 
            <span class={gateResult ? 'feature-enabled' : 'feature-disabled'}>
              {gateResult ? 'PASSED' : 'FAILED'}
            </span>
          </p>
        {/if}
      </div>
    </div>

    <div class="card">
      <h2>Reactive Store Example</h2>
      <p>
        firstFeature (from store): 
        <span class={$reactiveFeature ? 'feature-enabled' : 'feature-disabled'}>
          {$reactiveFeature ? 'ENABLED' : 'DISABLED'}
        </span>
      </p>
      <p><small>This updates reactively when the feature flag changes</small></p>
    </div>
  {/if}
</main>

<style>
  main {
    text-align: left;
  }

  h1 {
    text-align: center;
    font-size: 3.2em;
    line-height: 1.1;
  }

  h2 {
    margin-top: 0;
  }

  h3 {
    margin-top: 1em;
    font-size: 1.2em;
  }
</style>
