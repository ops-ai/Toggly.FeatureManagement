"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bindEvaluationContextChangeState = bindEvaluationContextChangeState;
exports.bindTogglyServiceContextState = bindTogglyServiceContextState;
exports.setBrowserSdkEvaluationContext = setBrowserSdkEvaluationContext;
exports.setEvaluationContextSafely = setEvaluationContextSafely;
function bindEvaluationContextChangeState(bindings) {
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
function bindTogglyServiceContextState(host) {
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
async function setBrowserSdkEvaluationContext(host, context, featureDefaults, runner) {
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
async function setEvaluationContextSafely(context, featureDefaults, options) {
    const previous = options.readState();
    const withheld = {
        ...previous,
        features: { ...featureDefaults },
        variants: null,
    };
    options.writeState(withheld);
    options.notifyRefresh();
    const next = {
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
    }
    catch (error) {
        options.writeState(previous);
        options.notifyRefresh();
        throw error;
    }
}
