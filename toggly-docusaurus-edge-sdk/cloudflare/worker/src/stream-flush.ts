/**
 * Wrap an upstream ReadableStream so consumer pulls drive reads (backpressure),
 * then invoke `onComplete` once when the consumer stream finishes or is cancelled.
 *
 * Unlike `ReadableStream.tee()` + eager drain, this does not buffer a second
 * copy of the entire body in memory.
 */
export function wrapReadableWithCompletion<T = Uint8Array>(
  upstream: ReadableStream<T>,
  onComplete: () => void | Promise<void>,
  waitUntil: (promise: Promise<unknown>) => void,
): ReadableStream<T> {
  const reader = upstream.getReader();
  let finished = false;

  const scheduleComplete = (): void => {
    if (finished) return;
    finished = true;
    waitUntil(
      (async () => {
        try {
          await onComplete();
        } catch {
          // soft-fail: never surface completion errors to the response stream
        }
      })(),
    );
  };

  return new ReadableStream<T>(
    {
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            scheduleComplete();
            return;
          }
          controller.enqueue(value as T);
        } catch (error) {
          try {
            controller.error(error);
          } finally {
            scheduleComplete();
          }
        }
      },
      cancel(reason) {
        return reader.cancel(reason).finally(() => {
          scheduleComplete();
        });
      },
    },
    // Default highWaterMark=1 chunk keeps queuing tight to the consumer.
    { highWaterMark: 1 },
  );
}
