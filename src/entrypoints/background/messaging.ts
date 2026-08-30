// MV3 message-response helpers. The background service worker is idle-killed
// after ~30s, which closes open message channels and throws:
// "listener indicated an asynchronous response by returning true, but the
// message channel closed before a response was received".
// These helpers guarantee exactly-one sendResponse and keep the SW alive during
// long async work (detection/OCR/translation, model downloads).

// Wraps sendResponse so it can only ever be called once (a second call throws).
export function createAsyncResponder(
  sendResponse: (response: unknown) => void,
) {
  let sent = false;
  return (response: unknown) => {
    if (sent) return;
    sent = true;
    sendResponse(response);
  };
}

// While the promise is pending, ping the runtime so the MV3 service worker is
// not considered idle. Cleared when the promise settles.
export function keepAliveWhile<T>(promise: Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    browser.runtime.getPlatformInfo().catch(() => {});
  }, 15000);
  return promise.finally(() => clearInterval(timer));
}

// Resolves with an error object instead of hanging forever when a long offscreen
// operation dies silently (e.g. an uncaught CSP violation crashes the offscreen
// document mid-run). Ensures every content-script `sendMessage` await gets an
// answer, so the overlay never sits on "Please wait..." indefinitely.
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ error: `Timed out after ${ms / 1000}s: ${label}` } as T),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        resolve({ error: (err as Error)?.message ?? String(err) } as T);
      },
    );
  });
}
