"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEvaluatedDefinitions = isEvaluatedDefinitions;
exports.isEntityGate = isEntityGate;
function isEvaluatedDefinitions(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
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
