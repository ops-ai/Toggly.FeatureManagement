"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEntityGate = isEntityGate;
exports.resolveEvaluatedDefinition = resolveEvaluatedDefinition;
exports.toBooleanDefinitions = toBooleanDefinitions;
exports.applyEntityGate = applyEntityGate;
exports.registerContext = registerContext;
exports.resolveEntityContext = resolveEntityContext;
exports.mapEntityContext = mapEntityContext;
exports.clearRegisteredContexts = clearRegisteredContexts;
exports.normalizeEntityContext = normalizeEntityContext;
exports.evaluateResolvedKeys = evaluateResolvedKeys;
exports.evaluateStoredFeatureKeys = evaluateStoredFeatureKeys;
exports.evaluateEvaluatedGate = evaluateEvaluatedGate;
const equalityOps = new Set(['eq', 'neq']);
const comparisonOps = new Set(['gt', 'gte', 'lt', 'lte']);
const inOps = new Set(['in']);
const containsOps = new Set(['contains']);
function isEntityGate(value) {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const gate = value;
    if (!Array.isArray(gate.rules)) {
        return false;
    }
    if (gate.requirement != null && gate.requirement !== 'all' && gate.requirement !== 'any') {
        return false;
    }
    return true;
}
/**
 * Resolves one evaluated definition to a boolean.
 *
 * An absent definition falls back to `defaultValue`; an entity gate without a
 * context always fails closed, so a default can never enable a gated feature.
 */
function resolveEvaluatedDefinition(value, context, defaultValue = false) {
    if (value == null) {
        return defaultValue;
    }
    if (value === true) {
        return true;
    }
    if (value === false) {
        return false;
    }
    if (!isEntityGate(value)) {
        return false;
    }
    if (!context) {
        return false;
    }
    return applyEntityGate(value, context.attributes);
}
/**
 * Flattens mixed definitions to plain booleans for consumers that cannot carry
 * entity gates (hook payloads, cached snapshots, legacy flag maps).
 */
function toBooleanDefinitions(definitions, context) {
    const result = {};
    for (const key of Object.keys(definitions)) {
        result[key] = resolveEvaluatedDefinition(definitions[key], context);
    }
    return result;
}
function applyEntityGate(gate, attributes) {
    if (gate.rules.length === 0) {
        return false;
    }
    const requirement = gate.requirement === 'any' ? 'any' : 'all';
    const results = gate.rules.map((rule) => evaluateRule(rule, attributes));
    return requirement === 'all' ? results.every(Boolean) : results.some(Boolean);
}
function evaluateRule(rule, attributes) {
    const actualKey = findAttributeKey(attributes, rule.property);
    if (actualKey === undefined) {
        return false;
    }
    const actual = attributes[actualKey];
    const op = rule.op.toLowerCase();
    const valueType = rule.type ?? 'string';
    if (equalityOps.has(op)) {
        return compareEquality(actual, rule.value, op === 'eq');
    }
    if (comparisonOps.has(op)) {
        return compareOrdered(actual, rule.value, valueType, op);
    }
    if (inOps.has(op)) {
        return compareIn(actual, rule.value);
    }
    if (containsOps.has(op)) {
        return compareContains(actual, rule.value, valueType);
    }
    return false;
}
function findAttributeKey(attributes, property) {
    if (Object.prototype.hasOwnProperty.call(attributes, property)) {
        return property;
    }
    const expected = property.toLowerCase();
    return Object.keys(attributes).find((key) => key.toLowerCase() === expected);
}
function compareEquality(actual, expected, shouldEqual) {
    const actualString = actual == null ? '' : String(actual);
    const equal = actualString.toLowerCase() === expected.toLowerCase();
    return shouldEqual ? equal : !equal;
}
function compareOrdered(actual, expected, valueType, op) {
    if (valueType === 'datetime') {
        const actualDate = parseDateTime(actual);
        const expectedDate = parseDateTime(expected);
        if (actualDate == null || expectedDate == null) {
            return false;
        }
        return compareNumbers(actualDate, expectedDate, op);
    }
    if (valueType !== 'number') {
        return false;
    }
    const actualNumber = parseNumber(actual);
    const expectedNumber = parseNumber(expected);
    if (actualNumber == null || expectedNumber == null) {
        return false;
    }
    return compareNumbers(actualNumber, expectedNumber, op);
}
function compareNumbers(actual, expected, op) {
    switch (op) {
        case 'gt':
            return actual > expected;
        case 'gte':
            return actual >= expected;
        case 'lt':
            return actual < expected;
        case 'lte':
            return actual <= expected;
        default:
            return false;
    }
}
function compareIn(actual, expected) {
    const actualString = actual == null ? '' : String(actual);
    return expected
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .some((candidate) => candidate.toLowerCase() === actualString.toLowerCase());
}
function compareContains(actual, expected, valueType) {
    if (valueType === 'string[]' && Array.isArray(actual)) {
        return actual.some((value) => String(value).toLowerCase() === expected.toLowerCase());
    }
    const actualString = actual == null ? '' : String(actual);
    return actualString.toLowerCase().includes(expected.toLowerCase());
}
function parseDateTime(value) {
    if (value instanceof Date) {
        return value.getTime();
    }
    if (typeof value === 'number') {
        return value;
    }
    const text = value == null ? '' : String(value);
    if (!text) {
        return null;
    }
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? null : parsed;
}
function parseNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const text = value == null ? '' : String(value);
    if (!text) {
        return null;
    }
    const parsed = Number(text);
    return Number.isNaN(parsed) ? null : parsed;
}
const contextMappers = new Map();
function registerContext(kind, mapper) {
    contextMappers.set(kind, mapper);
}
function resolveEntityContext(kind, entity) {
    const mapper = contextMappers.get(kind);
    if (!mapper) {
        return null;
    }
    return mapper(entity);
}
function mapEntityContext(kind, entity, mapper) {
    if (mapper) {
        return mapper(entity);
    }
    return resolveEntityContext(kind, entity);
}
function clearRegisteredContexts() {
    contextMappers.clear();
}
function normalizeEntityContext(context, kind) {
    if (!context) {
        return null;
    }
    if (typeof context === 'object' &&
        'kind' in context &&
        'key' in context &&
        'attributes' in context) {
        return context;
    }
    if (kind) {
        return mapEntityContext(kind, context);
    }
    return null;
}
function evaluateResolvedKeys(featureKeys, requirement, negate, isEnabled) {
    if (featureKeys.length === 0) {
        return !negate;
    }
    const result = requirement === 'any' ? featureKeys.some(isEnabled) : featureKeys.every(isEnabled);
    return negate ? !result : result;
}
/**
 * Client-SDK gate evaluation over stored mixed defs. An empty definition
 * set fails closed (`negate`) so a missing payload cannot open a gate.
 */
function evaluateStoredFeatureKeys(features, featureKeys, requirement, negate, isEnabled) {
    if (featureKeys.length > 0 && (!features || Object.keys(features).length === 0)) {
        return negate;
    }
    return evaluateResolvedKeys(featureKeys, requirement, negate, isEnabled);
}
function evaluateEvaluatedGate(features, featureKeys, requirement = 'all', negate = false, entityContext) {
    return evaluateStoredFeatureKeys(features, featureKeys, requirement, negate, (key) => resolveEvaluatedDefinition(features[key], entityContext));
}
