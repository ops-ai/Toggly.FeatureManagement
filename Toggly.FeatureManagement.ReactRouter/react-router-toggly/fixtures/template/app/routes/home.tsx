import {useEffect} from 'react';
import { Feature, FeatureGate, FeatureSwitch, useToggly, useFeature } from '@ops-ai/react-router-toggly/client';
import { gatedAction } from '../toggly.server';

export const action = gatedAction;

export default function Home() {
  const hidden = useFeature('Hidden');
  const ctx=useToggly();
  useEffect(()=>{Object.assign(window,{current:ctx});},[ctx]);
  return (
    <main>
      <h1>Router host</h1>
      <Feature featureKey="Visible">server rendered feature</Feature>
      <button id="local-off" onClick={()=>{ctx.setLocalGates([{id:'local',flagKeys:['Visible'],isEnabled:()=>false}]);ctx.notifyLocalGatesChanged();}}>Local off</button>
      <button id="local-on" onClick={()=>{ctx.setLocalGates([]);ctx.notifyLocalGatesChanged();}}>Local on</button>
      <button id="identify" onClick={()=>void ctx.identify('second-user')}>Identify</button>
      <button id="refresh" onClick={()=>void ctx.refresh()}>Refresh</button>
      <FeatureSwitch featureKey="Visible" enabled={<output id="visible">on</output>} disabled={<output id="visible">off</output>}/>
      <FeatureGate featureKeys={['Hidden','Skipped']} negate><output id="negated">on</output></FeatureGate>
      <output id="hidden">{String(hidden)}</output>
    </main>
  );
}
