// ABOUTME: Moves non-critical KV writes off the response path for Spotify services.
// ABOUTME: Hands promises to ctx.waitUntil when available, otherwise logs failures.

export type WaitUntil = (promise: Promise<unknown>) => void;

/** Schedules a background promise; `label` names it in error logs. */
export type Defer = (promise: Promise<unknown>, label: string) => void;

/**
 * Create a defer helper bound to the request's waitUntil.
 *
 * With waitUntil, the runtime keeps the invocation alive until the promise settles,
 * so the write survives the response being sent or the client disconnecting.
 * Without it (tests, scripts), the promise runs unawaited and failures are logged.
 */
export function createDefer(waitUntil?: WaitUntil): Defer {
  return (promise, label) => {
    const logged = promise.catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Spotify] Deferred ${label} failed:`, errorMessage, error);
    });
    waitUntil?.(logged);
  };
}
