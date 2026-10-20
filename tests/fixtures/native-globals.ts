/**
 * Bun's real fetch stack, kept aside before happy-dom replaces the globals.
 *
 * Imported by `tests/setup/happy-dom.ts` before it registers, so the values
 * below are the genuine ones: ESM runs every import body before the importing
 * module's own, which makes the ordering a guarantee rather than a hope.
 *
 * Why any test needs this: happy-dom substitutes `fetch`, `Request`,
 * `Response`, `Headers` and `WebSocket` for its own, and `Bun.serve` refuses a
 * happy-dom `Response` outright ("Expected a Response object"). The proxy runs
 * on Bun's stack in production — streamed bodies, `duplex: "half"`,
 * `redirect: "manual"`, automatic gzip decoding, a client socket that carries
 * headers — and none of that is what happy-dom implements. A test that wants to
 * prove the proxy forwards a real body through a real server has to run on the
 * real objects.
 *
 * `installNativeFetchGlobals` swaps them in for the length of one test file and
 * `restoreDomFetchGlobals` puts happy-dom back. Bun runs test files one after
 * another in a single process, so a swap paired in `beforeAll`/`afterAll` is
 * invisible to every other file — but it must be paired, or the next file to
 * render a component finds a DOM with no fetch of its own.
 */

type FetchGlobals = {
  fetch: typeof globalThis.fetch;
  Request: typeof globalThis.Request;
  Response: typeof globalThis.Response;
  Headers: typeof globalThis.Headers;
  WebSocket: typeof globalThis.WebSocket;
};

function snapshot(): FetchGlobals {
  return {
    fetch: globalThis.fetch,
    Request: globalThis.Request,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
    WebSocket: globalThis.WebSocket,
  };
}

function apply(globals: FetchGlobals): void {
  Object.assign(globalThis, globals);
}

/** Captured at import time, which is before happy-dom registers. */
export const nativeFetchGlobals: FetchGlobals = snapshot();

export const nativeFetch = nativeFetchGlobals.fetch;
export const NativeRequest = nativeFetchGlobals.Request;
export const NativeResponse = nativeFetchGlobals.Response;
export const NativeHeaders = nativeFetchGlobals.Headers;
export const NativeWebSocket = nativeFetchGlobals.WebSocket;

let replaced: FetchGlobals | null = null;

export function installNativeFetchGlobals(): void {
  if (replaced !== null) return;
  replaced = snapshot();
  apply(nativeFetchGlobals);
}

export function restoreDomFetchGlobals(): void {
  if (replaced === null) return;
  apply(replaced);
  replaced = null;
}
