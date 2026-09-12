import { createContext, createMemo, createResource, createSignal, getOwner, onCleanup, onMount, Show, useContext, type Accessor, type JSX, type Resource } from 'solid-js';
import { createClient, type ClientState, type EvaluatedDefinitions, type TogglyClient, type TogglyEntityContext, type TogglyOptions } from './client';
export * from './client';

export interface Toggly {
  client: TogglyClient;
  flags: Accessor<EvaluatedDefinitions>;
  loading: Accessor<boolean>;
  error: Accessor<Error | undefined>;
  resource: Resource<EvaluatedDefinitions>;
  evaluate: (keys: readonly string[], requirement?: 'all' | 'any', negate?: boolean, entity?: TogglyEntityContext) => boolean;
}

/** Create inside a Solid owner so subscriptions, fetches and timers share its lifetime. */
export function createToggly(options: TogglyOptions = {}): Toggly {
  if (!getOwner()) throw new Error('createToggly must run inside a Solid owner');
  const client = createClient(options);
  const [state, setState] = createSignal<ClientState>(client.state(), { equals: false });
  const unsubscribe = client.subscribe(next => setState(next));
  const [resource] = createResource(() => client.refresh());
  onMount(() => client.start());
  onCleanup(() => { unsubscribe(); client.dispose(); });
  return {
    client, resource,
    flags: () => state().definitions,
    loading: () => state().loading,
    error: () => state().error,
    evaluate(keys, requirement, negate, entity) { state(); return client.evaluate(keys, requirement, negate, entity); },
  };
}
const Context = createContext<Toggly>();
export function TogglyProvider(props: { config?: TogglyOptions; children?: JSX.Element }): JSX.Element {
  const toggly = createToggly(props.config);
  return <Context.Provider value={toggly}>{props.children}</Context.Provider>;
}
export function useToggly(): Toggly {
  const value = useContext(Context);
  if (!value) throw new Error('useToggly requires TogglyProvider');
  return value;
}
export function useFeatureFlag(key: string | Accessor<string>, entity?: Accessor<TogglyEntityContext | undefined>): Accessor<boolean> {
  const toggly = useToggly();
  return createMemo(() => toggly.evaluate([typeof key === 'function' ? key() : key], 'all', false, entity?.()));
}
export function useFeatureFlags(): Accessor<EvaluatedDefinitions> { return useToggly().flags; }
export interface FeatureProps {
  feature: string | readonly string[];
  requirement?: 'all' | 'any';
  negate?: boolean;
  entity?: TogglyEntityContext;
  fallback?: JSX.Element;
  loading?: JSX.Element;
  children?: JSX.Element;
}
/** Show only reads the selected branch, preserving lazy children and Solid ownership. */
export function Feature(props: FeatureProps): JSX.Element {
  const toggly = useToggly();
  const enabled = createMemo(() => toggly.evaluate(typeof props.feature === 'string' ? [props.feature] : props.feature, props.requirement, props.negate, props.entity));
  return <Show when={!toggly.loading()} fallback={props.loading}><Show when={enabled()} fallback={props.fallback}>{props.children}</Show></Show>;
}
