import { describe, expect, test } from "bun:test";

import {
  createNativeCookieBridge,
  createNativePaneBridge,
  type CookieImportReport,
  type NativeRect,
} from "../../src/native/native.bridge.ts";
import type { SessionCookie } from "../../src/session/session.types.ts";

const cookie: SessionCookie = {
  name: "session",
  value: "abc",
  domain: ".grafana.internal",
  path: "/",
  secure: true,
  httpOnly: true,
  expires: 1_800_000_000,
};

const empty: CookieImportReport = {
  received: 0,
  stored: 0,
  failedDomains: [],
};

type Call = { command: string; args: Record<string, unknown> };

function bridgeWith(
  isNative: boolean,
  respond: (call: Call) => Promise<CookieImportReport>,
) {
  const calls: Call[] = [];
  const bridge = createNativeCookieBridge({
    isNative: () => isNative,
    invoke: (command, args) => {
      const call = { command, args };
      calls.push(call);
      return respond(call);
    },
  });
  return { bridge, calls };
}

describe("the native pane bridge", () => {
  const rect: NativeRect = { x: 0, y: 0, width: 100, height: 100 };

  function paneBridgeWith() {
    const calls: Call[] = [];
    const bridge = createNativePaneBridge({
      invoke: async (command, args) => {
        calls.push({ command, args });
      },
    });
    return { bridge, calls };
  }

  test("leaves `navigate` unset so the shell keeps the page it is showing", async () => {
    const { bridge, calls } = paneBridgeWith();

    await bridge.show("pane-1", "https://dash.internal/", rect);

    // The shell treats a missing flag as "place only, if this is the address
    // you are already on" — which is what keeps a wall reload from throwing
    // away every pane's session. Sending `true` here would undo the fix.
    expect(calls).toEqual([
      {
        command: "pane_webview_show",
        args: {
          paneId: "pane-1",
          url: "https://dash.internal/",
          rect,
          navigate: undefined,
        },
      },
    ]);
  });

  test("passes `navigate` through when the caller means to replace the page", async () => {
    const { bridge, calls } = paneBridgeWith();

    await bridge.show("pane-1", "https://dash.internal/", rect, true);

    expect(calls[0]?.args["navigate"]).toBe(true);
  });
});

describe("the native cookie bridge", () => {
  test("answers in a plain browser instead of throwing", async () => {
    const { bridge, calls } = bridgeWith(false, async () => empty);

    const result = await bridge.importCookies([cookie]);

    expect(result).toEqual({ ok: false, reason: "not-native-host" });
    // There is no shell to reach, so nothing should have been attempted.
    expect(calls).toEqual([]);
  });

  test("hands the rows to the shell and returns what the store kept", async () => {
    const report: CookieImportReport = {
      received: 1,
      stored: 1,
      failedDomains: [],
    };
    const { bridge, calls } = bridgeWith(true, async () => report);

    const result = await bridge.importCookies([cookie]);

    expect(result).toEqual({ ok: true, report });
    expect(calls).toEqual([
      { command: "cookie_import", args: { cookies: [cookie] } },
    ]);
  });

  test("reports a partial import rather than calling it a success", async () => {
    const report: CookieImportReport = {
      received: 2,
      stored: 1,
      failedDomains: ["kibana.internal"],
    };
    const { bridge } = bridgeWith(true, async () => report);

    const result = await bridge.importCookies([cookie, cookie]);

    expect(result).toEqual({ ok: true, report });
  });

  test("turns a rejected command into a reason, not a throw", async () => {
    const { bridge } = bridgeWith(true, async () => {
      // Tauri rejects with the command's `Err(String)`, not an `Error`.
      throw "The wall window is not open";
    });

    const result = await bridge.importCookies([cookie]);

    expect(result).toEqual({ ok: false, reason: "The wall window is not open" });
  });

  test("skips the round trip when there is nothing to import", async () => {
    const { bridge, calls } = bridgeWith(true, async () => empty);

    const result = await bridge.importCookies([]);

    expect(result).toEqual({ ok: true, report: empty });
    expect(calls).toEqual([]);
  });
});
