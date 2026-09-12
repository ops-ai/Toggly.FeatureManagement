import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const assert = require('node:assert/strict')
const togglyKoa = require('@ops-ai/toggly-koa')

assert.equal(typeof togglyKoa.togglyMiddleware, 'function')
assert.equal(typeof togglyKoa.featureGate, 'function')
assert.equal(typeof togglyKoa.closeKoaToggly, 'function')
