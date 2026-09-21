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
  recordUsage: TogglyClient['recordUsage'];
  recordView: TogglyClient['recordView'];
  incrementCounter: TogglyClient['incrementCounter'];
  setGauge: TogglyClient['setGauge'];
  flushTelemetry: TogglyClient['flushTelemetry'];
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

const retiredClients = new WeakSet<TogglyClient>();

/** Create inside a Solid owner so subscriptions, fetches and timers share its lifetime. */
export function createToggly(
  options: TogglyOptions = {},
  initialSnapshot?: TogglySnapshot,
): Toggly {
  if (!getOwner()) throw new Error('createToggly must run inside a Solid owner');
  let client: TogglyClient | undefined;
  let retired = false;
  let unsubscribe = () => {};
  // Host diagnostics and transports can synchronously dispose the Solid owner.
  onCleanup(() => {
    retired = true;
    unsubscribe();
    if (client) {
      retiredClients.add(client);
      client.dispose();
    }
  });
  const [state, setState] = createSignal<ClientState>(
    { definitions: {}, loading: false, error: undefined },
    { equals: false },
  );
  const definitions = createMemo(() => state().definitions);
  const [started, setStarted] = createSignal(false);
  const [resource, { mutate, refetch }] = createResource(
    started,
    () => client!.refresh(),
    initialSnapshot ? { initialValue: {} } : ({} as ResourceOptions<EvaluatedDefinitions>),
  );
  let mounted = false;
  onMount(() => {
    if (retired) return;
    mounted = true;
    setStarted(true);
    if (!retired) client!.start();
  });
  const created = createClient(options, initialSnapshot);
  client = created;
  if (retired) {
    retiredClients.add(created);
    created.dispose();
  } else {
    setState(created.state());
    unsubscribe = created.subscribe((next) => {
      if (!retired) setState(next);
    });
    if (initialSnapshot) mutate(created.flags());
    // Activate only after every owner cleanup and subscription is installed.
    setStarted(!initialSnapshot && !isServer);
  }
  return {
    client: created,
    recordUsage: created.recordUsage,
    recordView: created.recordView,
    incrementCounter: created.incrementCounter,
    setGauge: created.setGauge,
    flushTelemetry: created.flushTelemetry,
    resource,
    hydrate(snapshot) {
      if (retired) return;
      created.hydrate(snapshot);
      mutate(created.flags());
      if (mounted) refetch();
    },
    flags: definitions,
    loading: () => state().loading,
    error: () => state().error,
    evaluate(keys, requirement, negate, entity) {
      definitions();
      return created.evaluate(keys, requirement, negate, entity);
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
  const snapshot = createMemo(() => props.snapshot);
  let previous = untrack(snapshot);
  const toggly = createToggly(props.config, previous);
  if (retiredClients.has(toggly.client)) return null;
  createEffect(() => {
    const next = snapshot();
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
      <Show when={enabled()}>{props.children}</Show>
    </Show>
  );
}
