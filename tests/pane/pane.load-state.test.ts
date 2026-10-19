import { describe, expect, test } from "bun:test";

import {
  INITIAL_PANE_LOAD_STATE,
  reducePaneLoad,
  type PaneLoadEvent,
  type PaneLoadState,
} from "../../src/pane/pane.load-state.ts";

const URL_A = "https://example.com/";
const URL_B = "https://info.cern.ch/";

function run(events: PaneLoadEvent[], from = INITIAL_PANE_LOAD_STATE): PaneLoadState {
  return events.reduce(reducePaneLoad, from);
}

describe("happy path", () => {
  test("empty -> probing -> loading -> ready", () => {
    expect(run([{ type: "url-set", url: URL_A }])).toEqual({
      kind: "probing",
      url: URL_A,
    });

    expect(
      run([
        { type: "url-set", url: URL_A },
        { type: "probe-settled", url: URL_A, verdict: "allowed", reason: "ok" },
      ]),
    ).toEqual({ kind: "loading", url: URL_A });

    expect(
      run([
        { type: "url-set", url: URL_A },
        { type: "probe-settled", url: URL_A, verdict: "allowed", reason: "ok" },
        { type: "frame-loaded", url: URL_A },
      ]),
    ).toEqual({ kind: "ready", url: URL_A });
  });
});

describe("refusal", () => {
  test("a refused probe produces an explicit refusal carrying the reason", () => {
    const state = run([
      { type: "url-set", url: URL_A },
      {
        type: "probe-settled",
        url: URL_A,
        verdict: "refused",
        reason: "x-frame-options: deny",
      },
    ]);
    expect(state).toEqual({
      kind: "refused",
      url: URL_A,
      reason: "x-frame-options: deny",
    });
  });

  test("a refused pane never silently becomes ready on a stray load event", () => {
    const state = run([
      { type: "url-set", url: URL_A },
      { type: "probe-settled", url: URL_A, verdict: "refused", reason: "deny" },
      { type: "frame-loaded", url: URL_A },
    ]);
    expect(state.kind).toBe("refused");
  });
});

describe("uncertain probes stay optimistic", () => {
  test("an unknown verdict still attempts the frame", () => {
    const state = run([
      { type: "url-set", url: URL_A },
      { type: "probe-settled", url: URL_A, verdict: "unknown", reason: "odd header" },
    ]);
    expect(state).toEqual({ kind: "loading", url: URL_A });
  });

  test("a failed probe still attempts the frame", () => {
    const state = run([
      { type: "url-set", url: URL_A },
      { type: "probe-failed", url: URL_A, reason: "network unreachable" },
    ]);
    expect(state).toEqual({ kind: "loading", url: URL_A });
  });
});

describe("stale events are discarded", () => {
  test("a probe for the previous url does not overwrite the current one", () => {
    const state = run([
      { type: "url-set", url: URL_A },
      { type: "url-set", url: URL_B },
      { type: "probe-settled", url: URL_A, verdict: "refused", reason: "deny" },
    ]);
    expect(state).toEqual({ kind: "probing", url: URL_B });
  });

  test("a load event for the previous url does not mark the current one ready", () => {
    const state = run([
      { type: "url-set", url: URL_A },
      { type: "probe-settled", url: URL_A, verdict: "allowed", reason: "ok" },
      { type: "url-set", url: URL_B },
      { type: "frame-loaded", url: URL_A },
    ]);
    expect(state).toEqual({ kind: "probing", url: URL_B });
  });
});

describe("the machine only produces states the union declares", () => {
  test("no event from any reachable state yields anything but these five kinds", () => {
    // The union once carried an `error` kind that no event produced. Anything
    // reachable here is a kind the UI has to handle, so the set is the contract.
    const kinds = ["empty", "probing", "loading", "ready", "refused"];
    const reachable: PaneLoadState[] = [
      INITIAL_PANE_LOAD_STATE,
      { kind: "probing", url: URL_A },
      { kind: "loading", url: URL_A },
      { kind: "ready", url: URL_A },
      { kind: "refused", url: URL_A, reason: "deny" },
    ];
    const events: PaneLoadEvent[] = [
      { type: "url-set", url: URL_B },
      { type: "url-cleared" },
      { type: "probe-settled", url: URL_A, verdict: "allowed", reason: "ok" },
      { type: "probe-settled", url: URL_A, verdict: "refused", reason: "deny" },
      { type: "probe-settled", url: URL_A, verdict: "unknown", reason: "odd" },
      { type: "probe-failed", url: URL_A, reason: "offline" },
      { type: "frame-loaded", url: URL_A },
      { type: "reload" },
    ];

    for (const state of reachable) {
      for (const event of events) {
        expect(kinds).toContain(reducePaneLoad(state, event).kind);
      }
    }
  });
});

describe("clearing and reloading", () => {
  test("clearing returns to empty", () => {
    const state = run([
      { type: "url-set", url: URL_A },
      { type: "url-cleared" },
    ]);
    expect(state).toEqual({ kind: "empty" });
  });

  test("reload re-probes the current url", () => {
    const state = run([
      { type: "url-set", url: URL_A },
      { type: "probe-settled", url: URL_A, verdict: "allowed", reason: "ok" },
      { type: "frame-loaded", url: URL_A },
      { type: "reload" },
    ]);
    expect(state).toEqual({ kind: "probing", url: URL_A });
  });

  test("reload on an empty pane does nothing", () => {
    expect(run([{ type: "reload" }])).toEqual({ kind: "empty" });
  });

  test("reload re-probes a refused pane, so a fixed dashboard recovers", () => {
    const state = run([
      { type: "url-set", url: URL_A },
      { type: "probe-settled", url: URL_A, verdict: "refused", reason: "deny" },
      { type: "reload" },
    ]);
    expect(state).toEqual({ kind: "probing", url: URL_A });
  });
});
