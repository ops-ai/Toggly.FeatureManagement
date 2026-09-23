function bounded(action, milliseconds, label) {
  let timer;
  return Promise.race([
    Promise.resolve().then(action),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function exited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

async function closeBrowser({ browser, browserServer }) {
  const errors = [];
  if (!browserServer) return errors;
  const processHandle = browserServer.process();
  const processClosed = exited(processHandle)
    ? Promise.resolve()
    : new Promise(resolve => processHandle.once('close', resolve));
  let gracefulFailed = false;
  if (browser) {
    try {
      await bounded(() => browser.close(), 2000, 'browser connection close');
    } catch (error) {
      errors.push(new Error(`browser.close failed: ${error.message}`, { cause: error }));
      gracefulFailed = true;
    }
  }
  try {
    await bounded(() => browserServer.close(), 2000, 'browser server close');
  } catch (error) {
    errors.push(new Error(`browserServer.close failed: ${error.message}`, { cause: error }));
    gracefulFailed = true;
  }
  if (gracefulFailed || !exited(processHandle)) {
    try {
      await bounded(() => browserServer.kill(), 2000, 'browser server kill');
    } catch (error) {
      errors.push(new Error(`browserServer.kill failed: ${error.message}`, { cause: error }));
    }
  }
  try {
    await bounded(() => processClosed, 2000, 'browser process exit');
  } catch (error) {
    errors.push(error);
    try {
      await bounded(() => browserServer.kill(), 2000, 'browser server kill after exit timeout');
      await bounded(() => processClosed, 2000, 'browser process forced exit');
    } catch (killError) {
      errors.push(killError);
    }
  }
  return errors;
}

async function stopChild(child) {
  if (exited(child)) return;
  const closed = new Promise(resolve => child.once('close', resolve));
  child.kill('SIGTERM');
  try {
    await bounded(() => closed, 3000, 'Gatsby graceful shutdown');
  } catch (error) {
    if (!String(error).includes('timed out')) throw error;
    child.kill('SIGKILL');
    await bounded(() => closed, 1000, 'Gatsby forced shutdown');
  }
}

async function cleanupOwnedResources(resources) {
  const results = await Promise.allSettled([
    closeBrowser(resources),
    stopChild(resources.serve),
    resources.collector && bounded(() => resources.collector.close(), 2000, 'collector.close'),
  ]);
  return results.flatMap(result => result.status === 'fulfilled' ? (result.value || []) : [result.reason]);
}

async function withOwnedResources(resources, run) {
  let result;
  let primaryError;
  try {
    result = await run();
  } catch (error) {
    primaryError = error;
  }
  const cleanupErrors = await cleanupOwnedResources(resources);
  if (primaryError) {
    if (cleanupErrors.length) primaryError.cause = new AggregateError(cleanupErrors, 'Resource cleanup failed');
    throw primaryError;
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Resource cleanup failed');
  return result;
}

module.exports = { bounded, withOwnedResources };
