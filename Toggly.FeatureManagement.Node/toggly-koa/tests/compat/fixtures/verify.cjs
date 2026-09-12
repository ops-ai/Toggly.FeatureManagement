const assert = require('node:assert/strict')
const togglyKoa = require('@ops-ai/toggly-koa')

assert.equal(typeof togglyKoa.togglyMiddleware, 'function')
assert.equal(typeof togglyKoa.featureGate, 'function')
assert.equal(typeof togglyKoa.closeKoaToggly, 'function')
