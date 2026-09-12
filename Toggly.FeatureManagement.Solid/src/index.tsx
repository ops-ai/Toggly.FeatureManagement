import { isServer } from 'solid-js/web';
import type { TogglySnapshot } from './snapshot.js';
export type { TogglySnapshot } from './snapshot.js';
import {
  createContext,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  getOwner,
  onCleanup,
  onMount,
  untrack,
  Show,
  useContext,
  type Accessor,
  type JSX,
  type Resource,
  type ResourceOptions,
} from 'solid-js';
import {
  createClient,
  type ClientState,
  type EvaluatedDefinitions,
  type TogglyClient,
  type TogglyEntityContext,
  type TogglyOptions,
} from './client';
export * from './client';

export interface Toggly {
  client: TogglyClient;
  hydrate(snapshot: TogglySnapshot): void;
  flags: Accessor<EvaluatedDefinitions>;
  loading: Accessor<boolean>;
  error: Accessor<Error | undefined>;
  resource: Resource<EvaluatedDefinitions>;
  evaluate: (
    keys: readonly string[],
    requirement?: 'all' | 'any',
    negate?: boolean,
    entity?: TogglyEntityContext,
  ) => boolean;
}

/** Create inside a Solid owner so subscriptions, fetches and timers share its lifetime. */
export function createToggly(
  options: TogglyOptions = {},
  initialSnapshot?: TogglySnapshot,
): Toggly {
  if (!getOwner()) throw new Error('createToggly must run inside a Solid owner');
  const client = createClient(options, initialSnapshot);
  const [state, setState] = createSignal<ClientState>(client.state(), { equals: false });
  const unsubscribe = client.subscribe((next) => setState(next));
  const [started, setStarted] = createSignal(!initialSnapshot && !isServer);
  const [resource, { mutate, refetch }] = createResource(
    started,
    () => client.refresh(),
    initialSnapshot
      ? { initialValue: client.flags() }
      : ({} as ResourceOptions<EvaluatedDefinitions>),
  );
  let mounted = false;
  onMount(() => {
    mounted = true;
    setStarted(true);
    client.start();
  });
  onCleanup(() => {
    unsubscribe();
    client.dispose();
  });
  return {
    client,
    resource,
    hydrate(snapshot) {
      client.hydrate(snapshot);
      mutate(client.flags());
      if (mounted) void refetch();
    },
    flags: () => state().definitions,
    loading: () => state().loading,
    error: () => state().error,
    evaluate(keys, requirement, negate, entity) {
      state();
      return client.evaluate(keys, requirement, negate, entity);
    },
  };
}
const Context = createContext<Toggly>();
/** Provide one browser session and replace its public state on route navigation. */
export function TogglyProvider(props: {
  config?: TogglyOptions;
  snapshot?: TogglySnapshot;
  children?: JSX.Element;
}): JSX.Element {
  let previous = untrack(() => props.snapshot);
  const toggly = createToggly(props.config, previous);
  createEffect(() => {
    const next = props.snapshot;
    if (next && next !== previous) {
      previous = next;
      untrack(() => toggly.hydrate(next));
    }
  });
  return <Context.Provider value={toggly}>{props.children}</Context.Provider>;
}
/** Read the nearest provider; calling outside one is a configuration error. */
export function useToggly(): Toggly {
  const value = useContext(Context);
  if (!value) throw new Error('useToggly requires TogglyProvider');
  return value;
}
/** Return a reactive decision, evaluating the current entity at each read. */
export function useFeatureFlag(
  key: string | Accessor<string>,
  entity?: Accessor<TogglyEntityContext | undefined>,
): Accessor<boolean> {
  const toggly = useToggly();
  return createMemo(() =>
    toggly.evaluate([typeof key === 'function' ? key() : key], 'all', false, entity?.()),
  );
}
/** Observe the current public evaluated definitions without flattening entity rules. */
export function useFeatureFlags(): Accessor<EvaluatedDefinitions> {
  return useToggly().flags;
}
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
  const enabled = createMemo(() =>
    toggly.evaluate(
      typeof props.feature === 'string' ? [props.feature] : props.feature,
      props.requirement,
      props.negate,
      props.entity,
    ),
  );
  return (
    <Show when={!toggly.loading()} fallback={props.loading}>
      <Show when={enabled()} fallback={props.fallback}>
        {props.children}
      </Show>
    </Show>
  );
}
