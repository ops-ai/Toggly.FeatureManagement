"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rolloutBucket = exports.identityBucket = exports.targeting = exports.timeWindow = exports.percentage = exports.alwaysOff = exports.alwaysOn = void 0;
exports.asFloat = asFloat;
exports.asBool = asBool;
exports.asString = asString;
exports.setTimeWindowNow = setTimeWindowNow;
exports.createDefaultRegistry = createDefaultRegistry;
const hash_1 = require("./hash");
Object.defineProperty(exports, "identityBucket", { enumerable: true, get: function () { return hash_1.identityBucket; } });
Object.defineProperty(exports, "rolloutBucket", { enumerable: true, get: function () { return hash_1.rolloutBucket; } });
function asFloat(params, key) {
    if (!params) {
        return undefined;
    }
    const v = params[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
        return v;
    }
    if (typeof v === 'string') {
        const f = Number.parseFloat(v);
        return Number.isFinite(f) ? f : undefined;
    }
    return undefined;
}
function asBool(params, key) {
    if (!params) {
        return undefined;
    }
    const v = params[key];
    if (typeof v === 'boolean') {
        return v;
    }
    if (typeof v === 'string') {
        if (v === 'true' || v === 'True' || v === '1') {
            return true;
        }
        if (v === 'false' || v === 'False' || v === '0') {
            return false;
        }
    }
    return undefined;
}
function asString(params, key) {
    if (!params) {
        return undefined;
    }
    const v = params[key];
    return typeof v === 'string' ? v : undefined;
}
function asStringValue(v) {
    return typeof v === 'string' ? v : undefined;
}
function parseTime(s) {
    const t = Date.parse(s);
    if (Number.isNaN(t)) {
        return undefined;
    }
    return new Date(t);
}
function collectPrefixedStrings(params, prefix) {
    if (!params) {
        return [];
    }
    const out = [];
    const needle = `${prefix}:`;
    for (const [k, v] of Object.entries(params)) {
        if (!k.startsWith(needle)) {
            continue;
        }
        const s = asStringValue(v);
        if (s) {
            out.push(s);
        }
    }
    return out;
}
function contains(list, val, ignoreCase) {
    for (const s of list) {
        if (ignoreCase) {
            if (s.toLowerCase() === val.toLowerCase()) {
                return true;
            }
        }
        else if (s === val) {
            return true;
        }
    }
    return false;
}
const alwaysOn = () => true;
exports.alwaysOn = alwaysOn;
const alwaysOff = () => false;
exports.alwaysOff = alwaysOff;
const percentage = (_featureKey, params, ctx) => {
    let pct = asFloat(params, 'Value');
    if (pct === undefined) {
        pct = asFloat(params, 'Percentage');
    }
    if (pct === undefined || pct <= 0) {
        return false;
    }
    if (pct >= 100) {
        return true;
    }
    if (!ctx.identity) {
        return false;
    }
    return (0, hash_1.identityBucket)(ctx.identity) < pct;
};
exports.percentage = percentage;
let timeWindowNow;
/** Test hook to pin TimeWindow "now". */
function setTimeWindowNow(fn) {
    timeWindowNow = fn;
}
const timeWindow = (_featureKey, params, _ctx) => {
    const startS = asString(params, 'Start');
    const endS = asString(params, 'End');
    if (!startS || !endS) {
        return false;
    }
    const start = parseTime(startS);
    const end = parseTime(endS);
    if (!start || !end) {
        return false;
    }
    const now = (timeWindowNow?.() ?? new Date()).getTime();
    return now >= start.getTime() && now <= end.getTime();
};
exports.timeWindow = timeWindow;
const targeting = (featureKey, params, ctx) => {
    const ignoreCase = asBool(params, 'IgnoreCase') ?? false;
    const identity = ctx.identity ?? '';
    if (identity) {
        const users = collectPrefixedStrings(params, 'Audience.Users');
        if (contains(users, identity, ignoreCase)) {
            return true;
        }
    }
    if (ctx.groups && ctx.groups.length > 0) {
        const groups = collectPrefixedStrings(params, 'Audience.Groups');
        for (const g of ctx.groups) {
            if (contains(groups, g, ignoreCase)) {
                return true;
            }
        }
    }
    let pct = asFloat(params, 'Audience.DefaultRolloutPercentage');
    if (pct === undefined) {
        pct = asFloat(params, 'Percentage');
    }
    if (pct === undefined || pct <= 0) {
        return false;
    }
    if (pct >= 100) {
        return true;
    }
    if (!identity) {
        return false;
    }
    return (0, hash_1.rolloutBucket)(featureKey, identity) < pct;
};
exports.targeting = targeting;
function createDefaultRegistry() {
    const reg = new Map();
    reg.set('AlwaysOn', exports.alwaysOn);
    reg.set('AlwaysOff', exports.alwaysOff);
    reg.set('Percentage', exports.percentage);
    reg.set('TimeWindow', exports.timeWindow);
    reg.set('Targeting', exports.targeting);
    return reg;
}
