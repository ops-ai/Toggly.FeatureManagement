"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bindEvaluationContextChangeState = bindEvaluationContextChangeState;
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
