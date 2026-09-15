import { Feature, useFeature } from '@ops-ai/react-router-toggly/client';
import { gatedAction } from '../toggly.server';

export const action = gatedAction;

export default function Home() {
  const hidden = useFeature('Hidden');
  return (
    <main>
      <h1>Router host</h1>
      <Feature featureKey="Visible">server rendered feature</Feature>
      <output id="hidden">{String(hidden)}</output>
    </main>
  );
}
