import { Feature, useFeatureFlag } from '@ops-ai/astro-feature-flags-toggly/react';
export default function ReactIsland() {
  const { enabled, isReady } = useFeatureFlag('Visible');
  return <section><output id="react-state">{isReady ? String(enabled) : 'loading'}</output>
    <Feature flag="Visible"><span id="react-content">react-enabled</span></Feature></section>;
}
