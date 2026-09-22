/** Bound teardown while retaining failures and attempting every owned cleanup. */
export async function withCleanupTimeout(action, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} cleanup timed out`)), 5000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function withHostResources(run) {
  const cleanups = [];
  const errors = [];
  let result;
  try {
    result = await run(cleanup => cleanups.push(cleanup));
  } catch (error) {
    errors.push(error);
  } finally {
    for (const cleanup of cleanups.reverse()) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Host verification and cleanup failed');
  return result;
}
