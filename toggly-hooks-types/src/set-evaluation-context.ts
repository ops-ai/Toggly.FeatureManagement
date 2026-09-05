import type { TogglyEvaluationContext } from './evaluation-context';

export interface EvaluationContextChangeState<TFeatures = unknown, TVariants = unknown> {
  identity?: string;
  groups: string[];
  claims: Record<string, string>;
  features: TFeatures | null;
  variants: TVariants | null;
}

export interface SetEvaluationContextSafelyOptions<TFeatures, TVariants> {
  readState: () => EvaluationContextChangeState<TFeatures, TVariants>;
  writeState: (state: EvaluationContextChangeState<TFeatures, TVariants>) => void;
  notifyRefresh: () => void;
  refreshStrict: () => Promise<unknown>;
}

export interface EvaluationContextChangeBindings<TFeatures, TVariants> {
  identity: {
    get: () => string | undefined;
    set: (value: string | undefined) => void;
  };
  groups: {
    get: () => string[];
    set: (value: string[]) => void;
  };
  claims: {
    get: () => Record<string, string>;
    set: (value: Record<string, string>) => void;
  };
  features: {
    get: () => TFeatures | null;
    set: (value: TFeatures | null) => void;
  };
  variants: {
    get: () => TVariants | null;
    set: (value: TVariants | null) => void;
  };
}

export interface TogglyServiceContextHost<TFeatures, TVariants> {
  _config: {
    identity?: string;
    featureDefaults?: Record<string, unknown>;
  };
  _groups: string[];
  _claims: Record<string, string>;
  _features: TFeatures | null;
  _variants: TVariants | null;
}

export function bindEvaluationContextChangeState<TFeatures, TVariants>(
  bindings: EvaluationContextChangeBindings<TFeatures, TVariants>,
): Pick<SetEvaluationContextSafelyOptions<TFeatures, TVariants>, 'readState' | 'writeState'> {
  return {
    readState: () => ({
      identity: bindings.identity.get(),
      groups: [...bindings.groups.get()],
      claims: { ...bindings.claims.get() },
      features: bindings.features.get(),
      variants: bindings.variants.get(),
    }),
    writeState: (state) => {
      bindings.identity.set(state.identity);
      bindings.groups.set([...state.groups]);
      bindings.claims.set({ ...state.claims });
      bindings.features.set(state.features);
      bindings.variants.set(state.variants);
    },
  };
}

export function bindTogglyServiceContextState<TFeatures, TVariants>(
  host: TogglyServiceContextHost<TFeatures, TVariants>,
): Pick<SetEvaluationContextSafelyOptions<TFeatures, TVariants>, 'readState' | 'writeState'> {
  return bindEvaluationContextChangeState({
    identity: {
      get: () => host._config.identity,
      set: (value) => {
        host._config.identity = value;
      },
    },
    groups: {
      get: () => host._groups,
      set: (value) => {
        host._groups = value;
      },
    },
    claims: {
      get: () => host._claims,
      set: (value) => {
        host._claims = value;
      },
    },
    features: {
      get: () => host._features,
      set: (value) => {
        host._features = value;
      },
    },
    variants: {
      get: () => host._variants,
      set: (value) => {
        host._variants = value;
      },
    },
  });
}

export interface BrowserSdkContextRunner {
  notifyFeaturesRefresh(): void;
  loadFeaturesStrict(): Promise<unknown>;
}

export async function setBrowserSdkEvaluationContext<TFeatures, TVariants>(
  host: TogglyServiceContextHost<TFeatures, TVariants>,
  context: TogglyEvaluationContext,
  featureDefaults: Record<string, unknown>,
  runner: BrowserSdkContextRunner,
): Promise<void> {
  return setEvaluationContextSafely(context, featureDefaults, {
    ...bindTogglyServiceContextState(host),
    notifyRefresh: () => runner.notifyFeaturesRefresh(),
    refreshStrict: () => runner.loadFeaturesStrict(),
  });
}

/**
 * Withhold prior evaluated state, apply partial context updates, and refresh under
 * strict mode. Restores the prior snapshot when refresh fails.
 */
export async function setEvaluationContextSafely<TFeatures, TVariants>(
  context: TogglyEvaluationContext,
  featureDefaults: Record<string, unknown>,
  options: SetEvaluationContextSafelyOptions<TFeatures, TVariants>,
): Promise<void> {
  const previous = options.readState();

  const withheld: EvaluationContextChangeState<TFeatures, TVariants> = {
    ...previous,
    features: { ...featureDefaults } as TFeatures,
    variants: null,
  };
  options.writeState(withheld);
  options.notifyRefresh();

  const next: EvaluationContextChangeState<TFeatures, TVariants> = {
    ...withheld,
  };
  if (context.identity !== undefined) {
    next.identity = context.identity || undefined;
  }
  if (context.groups !== undefined) {
    next.groups = [...context.groups];
  }
  if (context.claims !== undefined) {
    next.claims = { ...context.claims };
  }
  options.writeState(next);

  try {
    await options.refreshStrict();
  } catch (error) {
    options.writeState(previous);
    options.notifyRefresh();
    throw error;
  }
}
