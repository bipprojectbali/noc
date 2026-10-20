import { describe, expect, test } from "bun:test";

import {
  createNativeCookieBridge,
  type CookieImportReport,
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
