import { describe, expect, test } from "bun:test";

import type {
  CookieImportReport,
  NativeCookieBridge,
} from "../../src/native/native.bridge.ts";
import { createSessionStore } from "../../src/session/session.store.ts";
import type { SessionCookie } from "../../src/session/session.types.ts";

const JSON_EXPORT = JSON.stringify([
  {
    name: "session",
    value: "abc",
    domain: ".grafana.internal",
    path: "/",
    secure: true,
    httpOnly: true,
    expirationDate: 1_800_000_000,
  },
]);

/** Two good rows and one that is not an object, so the parser skips exactly one. */
const JSON_EXPORT_WITH_JUNK = JSON.stringify([
  { name: "a", value: "1", domain: ".grafana.internal" },
  "not a cookie",
  { name: "b", value: "2", domain: ".kibana.internal" },
]);

function reportOf(partial: Partial<CookieImportReport>): CookieImportReport {
  return { received: 1, stored: 1, failedDomains: [], ...partial };
}

type Harness = {
  store: ReturnType<typeof createSessionStore>;
  /** One entry per `importCookies` call, holding what the store handed over. */
  handed: (readonly SessionCookie[])[];
  reloads: number;
};

function harness(
  answer: () => Promise<
    { ok: true; report: CookieImportReport } | { ok: false; reason: string }
  >,
): Harness {
  const handed: (readonly SessionCookie[])[] = [];
  const state = { reloads: 0 };
  const cookieBridge: NativeCookieBridge = {
    importCookies: (cookies) => {
      handed.push(cookies);
      return answer();
    },
  };
  const store = createSessionStore({
    cookieBridge,
    reloadPanes: () => {
      state.reloads += 1;
    },
    now: () => 1_700_000_000_000,
  });
  return {
    store,
    handed,
    get reloads() {
      return state.reloads;
    },
  };
}

function succeeds(report: Partial<CookieImportReport> = {}) {
  return async () => ({ ok: true as const, report: reportOf(report) });
}

describe("the session import store", () => {
  test("starts idle", () => {
    const { store } = harness(succeeds());

    expect(store.getState().importState).toEqual({ kind: "idle" });
  });

  test("reaches done with the shell's numbers after a good file", async () => {
    const h = harness(succeeds({ received: 1, stored: 1 }));

    await h.store.getState().importFromText(JSON_EXPORT);

    expect(h.store.getState().importState).toEqual({
      kind: "done",
      stored: 1,
      skipped: 0,
      failedDomains: [],
      at: 1_700_000_000_000,
    });
  });

  test("hands the parsed cookies to the bridge, not the raw text", async () => {
    const h = harness(succeeds());

    await h.store.getState().importFromText(JSON_EXPORT);

    expect(h.handed).toHaveLength(1);
    expect(h.handed[0]).toEqual([
      {
        name: "session",
        value: "abc",
        domain: ".grafana.internal",
        path: "/",
        secure: true,
        httpOnly: true,
        expires: 1_800_000_000,
      },
    ]);
  });

  test("is importing while the shell is still answering", async () => {
    let release = (): void => {};
    const h = harness(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, report: reportOf({}) });
        }),
    );

    const running = h.store.getState().importFromText(JSON_EXPORT);
    expect(h.store.getState().importState).toEqual({ kind: "importing" });

    release();
    await running;
    expect(h.store.getState().importState.kind).toBe("done");
  });

  test("carries the parser's skipped rows into the done state", async () => {
    const h = harness(succeeds({ received: 2, stored: 2 }));

    await h.store.getState().importFromText(JSON_EXPORT_WITH_JUNK);

    const state = h.store.getState().importState;
    expect(state.kind).toBe("done");
    if (state.kind !== "done") throw new Error("unreachable");
    expect(state.stored).toBe(2);
    // The one entry the parser dropped, even though the shell kept everything
    // it was given — otherwise a partial import reads as a total one.
    expect(state.skipped).toBe(1);
  });

  test("counts cookies the store refused alongside the parser's", async () => {
    const h = harness(
      succeeds({ received: 2, stored: 1, failedDomains: [".kibana.internal"] }),
    );

    await h.store.getState().importFromText(JSON_EXPORT_WITH_JUNK);

    const state = h.store.getState().importState;
    if (state.kind !== "done") throw new Error("expected done");
    expect(state.stored).toBe(1);
    // One dropped by the parser, one WebKit did not keep. stored + skipped is
    // always the number of rows the file held.
    expect(state.skipped).toBe(2);
    expect(state.failedDomains).toEqual([".kibana.internal"]);
  });

  test("errors with the parser's reason and never reaches the shell", async () => {
    const h = harness(succeeds());

    await h.store.getState().importFromText("   \n  ");

    expect(h.store.getState().importState).toEqual({
      kind: "error",
      reason: "empty-file",
    });
    expect(h.handed).toEqual([]);
    expect(h.reloads).toBe(0);
  });

  test("errors on a file that is neither format, without calling the shell", async () => {
    const h = harness(succeeds());

    await h.store.getState().importFromText("just some prose, no tabs");

    expect(h.store.getState().importState).toEqual({
      kind: "error",
      reason: "unrecognised-format",
    });
    expect(h.handed).toEqual([]);
  });

  test("errors when the format was understood but nothing survived", async () => {
    const h = harness(succeeds());

    await h.store.getState().importFromText(JSON.stringify([{ name: "" }]));

    expect(h.store.getState().importState).toEqual({
      kind: "error",
      reason: "no-valid-cookies",
    });
    expect(h.handed).toEqual([]);
  });

  test("errors with the shell's reason and does not reload", async () => {
    const h = harness(async () => ({
      ok: false as const,
      reason: "not-native-host",
    }));

    await h.store.getState().importFromText(JSON_EXPORT);

    expect(h.store.getState().importState).toEqual({
      kind: "error",
      reason: "not-native-host",
    });
    // Nothing was planted, so reloading would only cost every pane its page.
    expect(h.reloads).toBe(0);
  });

  test("reloads the wall exactly once after a success", async () => {
    const h = harness(succeeds());

    await h.store.getState().importFromText(JSON_EXPORT);

    expect(h.reloads).toBe(1);
  });

  test("reloads once more per import, not once per cookie", async () => {
    const h = harness(succeeds({ received: 2, stored: 2 }));

    await h.store.getState().importFromText(JSON_EXPORT_WITH_JUNK);
    expect(h.reloads).toBe(1);

    await h.store.getState().importFromText(JSON_EXPORT_WITH_JUNK);
    expect(h.reloads).toBe(2);
  });

  test("goes back to idle when reset", async () => {
    const h = harness(succeeds());

    await h.store.getState().importFromText(JSON_EXPORT);
    h.store.getState().reset();

    expect(h.store.getState().importState).toEqual({ kind: "idle" });
  });
});
