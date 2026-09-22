import { useEffect } from 'react';
import { useStore } from '@nanostores/react';
import type { ConsumerAtom } from '../client/store.js';

// React can discard a hydration render or replay subscriptions in StrictMode.
// Only a committed consumer admits its initial captured evaluation; subscribed
// atom recomputations continue to report at the actual evaluation boundary.
export function useConsumerStore(store: ConsumerAtom): boolean {
  const value = useStore(store);
  useEffect(() => store.commit(), [store]);
  return value;
}
