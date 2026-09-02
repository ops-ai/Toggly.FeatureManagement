"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateDefinition = evaluateDefinition;
exports.evaluateDefinitions = evaluateDefinitions;
exports.evaluateFeatureGate = evaluateFeatureGate;
exports.indexDefinitions = indexDefinitions;
exports.parseDefinitionsPayload = parseDefinitionsPayload;
exports.snapshotEvaluatedBooleans = snapshotEvaluatedBooleans;
const builtin_1 = require("./builtin");
const context_property_1 = require("./context-property");
function normalizeRequirement(req) {
    if (!req) {
        return 'Any';
    }
    if (req.toLowerCase() === 'all') {
        return 'All';
    }
    return 'Any';
}
function evaluateGroup(registry, featureKey, filters, req, ctx) {
    const requirement = normalizeRequirement(req);
    if (filters.length === 0) {
        return false;
    }
    if (requirement === 'All') {
        for (const f of filters) {
            const ev = registry.get(f.name);
            if (!ev) {
                return false;
            }
            if (!ev(featureKey, f.parameters, ctx)) {
                return false;
            }
        }
        return true;
    }
    for (const f of filters) {
        const ev = registry.get(f.name);
        if (!ev) {
            continue;
        }
        if (ev(featureKey, f.parameters, ctx)) {
            return true;
        }
    }
    return false;
}
let defaultRegistry = null;
function getDefaultRegistry() {
    if (!defaultRegistry) {
        defaultRegistry = (0, builtin_1.createDefaultRegistry)();
    }
    return defaultRegistry;
}
/**
 * Evaluate a single feature definition against an evaluation context.
 * Missing / unknown filters are treated as false (IgnoreMissingFeatureFilters).
 */
function evaluateDefinition(def, ctx = {}, registry = getDefaultRegistry()) {
    const filters = def.filters ?? [];
    if (filters.length === 0) {
        return false;
    }
    const { entity: entityFilters, user: userFilters } = (0, context_property_1.splitFilters)(def);
    if (entityFilters.length > 0) {
        if (!ctx.entity) {
            return false;
        }
        if (!(0, context_property_1.evaluateEntityFilters)(def, ctx.entity)) {
            return false;
        }
        if (userFilters.length === 0) {
            return true;
        }
        return evaluateGroup(registry, def.featureKey, userFilters, def.requirementType, ctx);
    }
    return evaluateGroup(registry, def.featureKey, userFilters, def.requirementType, ctx);
}
/**
 * Look up a definition by key and evaluate it. Unknown keys → false.
 */
function evaluateDefinitions(defsByKey, featureKey, ctx = {}, registry) {
    const def = defsByKey.get(featureKey);
    if (!def) {
        return false;
    }
    return evaluateDefinition(def, ctx, registry ?? getDefaultRegistry());
}
/**
 * Evaluate multiple feature keys with any/all + optional negate.
 */
function evaluateFeatureGate(defsByKey, featureKeys, requirement = 'all', negate = false, ctx = {}, registry) {
    if (featureKeys.length === 0) {
        return !negate;
    }
    const reg = registry ?? getDefaultRegistry();
    let result;
    if (requirement === 'any') {
        result = featureKeys.some((key) => evaluateDefinitions(defsByKey, key, ctx, reg));
    }
    else {
        result = featureKeys.every((key) => evaluateDefinitions(defsByKey, key, ctx, reg));
    }
    return negate ? !result : result;
}
/**
 * Index a definitions-signed array by featureKey.
 */
function indexDefinitions(definitions) {
    const map = new Map();
    if (!definitions) {
        return map;
    }
    for (const def of definitions) {
        if (def?.featureKey) {
            map.set(def.featureKey, def);
        }
    }
    return map;
}
/**
 * Parse a definitions payload (array or signed envelope defs) into a map.
 */
function parseDefinitionsPayload(raw) {
    if (Array.isArray(raw)) {
        return indexDefinitions(raw);
    }
    if (raw && typeof raw === 'object' && 'defs' in raw) {
        const defs = raw.defs;
        if (Array.isArray(defs)) {
            return indexDefinitions(defs);
        }
    }
    return new Map();
}
/**
 * Snapshot evaluated booleans for all known keys (entity gates fail closed
 * without entity context). Useful for hydration helpers.
 */
function snapshotEvaluatedBooleans(defsByKey, ctx = {}) {
    const out = {};
    for (const key of defsByKey.keys()) {
        out[key] = evaluateDefinitions(defsByKey, key, ctx);
    }
    return out;
}
