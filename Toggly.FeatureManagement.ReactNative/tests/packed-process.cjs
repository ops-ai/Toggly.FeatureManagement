const { spawn } = require('node:child_process');

const children = new Set();
function stop(child) {
  try { process.kill(-child.pid, 'SIGKILL'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
process.once('exit', () => { for (const child of children) { try { stop(child); } catch {} } });

/** Bound a command and retire its whole owned process group, including inherited workers. */
function run(command, args, { cwd, env = process.env, capture = false, timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, detached: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    children.add(child);
    let output = '';
    let failure;
    const retire = () => { try { stop(child); } catch (error) { failure ??= error; } };
    const timer = setTimeout(() => { failure = new Error(`${command} exceeded ${timeoutMs}ms`); retire(); }, timeoutMs);
    const interrupt = () => { failure = new Error(`${command} interrupted`); retire(); };
    process.once('SIGTERM', interrupt);
    process.once('SIGINT', interrupt);
    if (capture) {
      const collect = chunk => {
        output += chunk;
        if (output.length > 2_000_000) { failure = new Error(`${command} output exceeded 2MB`); retire(); }
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
    }
    child.once('error', error => { failure = error; });
    child.once('exit', retire);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      process.removeListener('SIGTERM', interrupt);
      process.removeListener('SIGINT', interrupt);
      children.delete(child);
      if (failure || code !== 0) reject(failure ?? new Error(`${command} exited ${code ?? signal}\n${output}`));
      else resolve(output);
    });
  });
}

module.exports = { run };
