// Owned Gatsby build diagnostics only. Never log environment values or request payloads.
const { createHook } = require('node:async_hooks');
const active = new Map();
const started = Date.now();
const hook = createHook({
  init(id, type) {
    if (['Timeout', 'TCPWRAP', 'TCPSERVERWRAP', 'PROCESSWRAP'].includes(type)) active.set(id, { type, stack: new Error().stack });
  },
  destroy(id) { active.delete(id); },
});
hook.enable();
setTimeout(() => {
  console.error('GATSBY_SLOW_BUILD_RESOURCES', JSON.stringify({ pid: process.pid, elapsedMs: Date.now() - started, resources: process.getActiveResourcesInfo(), active: [...active.values()] }));
}, 45000).unref();
process.once('beforeExit', code => console.error('GATSBY_BUILD_BEFORE_EXIT', JSON.stringify({ pid: process.pid, code, elapsedMs: Date.now() - started, resources: process.getActiveResourcesInfo() })));
process.once('exit', code => console.error('GATSBY_BUILD_EXIT', JSON.stringify({ pid: process.pid, code, elapsedMs: Date.now() - started })));
