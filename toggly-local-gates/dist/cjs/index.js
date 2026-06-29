"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFlagGateIndex = buildFlagGateIndex;
exports.isLocalPrerequisiteMet = isLocalPrerequisiteMet;
exports.applyLocalGate = applyLocalGate;
exports.applyLocalGatesToMap = applyLocalGatesToMap;
/**
 * Builds a flag-key → gate-id index. Throws if a flag key appears in more than one gate.
 */
function buildFlagGateIndex(gates) {
    const index = new Map();
    for (const gate of gates) {
        for (const flagKey of gate.flagKeys) {
            const existing = index.get(flagKey);
            if (existing !== undefined && existing !== gate.id) {
                throw new Error(`Flag key "${flagKey}" is registered on multiple local gates ("${existing}" and "${gate.id}")`);
            }
            index.set(flagKey, gate.id);
        }
    }
    return index;
}
function findGate(gates, gateId) {
    return gates.find((gate) => gate.id === gateId);
}
/**
 * Returns whether the local prerequisite allows the flag (true when ungated).
 */
function isLocalPrerequisiteMet(flagKey, gates, gateIndex) {
    const gateId = gateIndex.get(flagKey);
    if (gateId === undefined) {
        return true;
    }
    const gate = findGate(gates, gateId);
    return gate?.isEnabled() ?? true;
}
/**
 * Applies the local post-filter to a single remote boolean.
 */
function applyLocalGate(remote, flagKey, gates, gateIndex) {
    if (!remote) {
        return false;
    }
    return isLocalPrerequisiteMet(flagKey, gates, gateIndex);
}
/**
 * Applies local gates to every key in a remote flag map (for bulk/debug use).
 */
function applyLocalGatesToMap(remoteFlags, gates, gateIndex) {
    const index = gateIndex ?? buildFlagGateIndex(gates);
    const effective = {};
    for (const [flagKey, remote] of Object.entries(remoteFlags)) {
        effective[flagKey] = applyLocalGate(remote, flagKey, gates, index);
    }
    return effective;
}
