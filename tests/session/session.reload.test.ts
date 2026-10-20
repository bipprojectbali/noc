/**
 * The seam the fake in `session.store.test` stands in for.
 *
 * That test proves the store calls its `reloadPanes` dependency once. This one
 * proves the thing wired into that dependency actually reaches the real wall
 * store and moves every pane, which is the half that decides whether a planted
 * cookie is ever used: a pane that is not refetched keeps showing the login
 * page it was served before the import.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { isPane, type PaneId } from "../../src/layout/layout.types.ts";
import { paneLoadState, useWallStore } from "../../src/pane/pane.store.ts";
import { reloadEveryPane } from "../../src/session/session.store.ts";
import { resetWallStore, settleAsyncWork } from "../fixtures/wall-store.ts";

const realFetch = globalThis.fetch;
let probes: string[] = [];

beforeEach(() => {
  probes = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    probes.push(String(input));
    return new Response(
      JSON.stringify({ verdict: "unknown", reason: "stub" }),
      { headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  resetWallStore("root");
});

afterEach(async () => {
  await settleAsyncWork();
  globalThis.fetch = realFetch;
});

function paneIds(): PaneId[] {
  return Object.values(useWallStore.getState().tree.nodes)
    .filter(isPane)
    .map((pane) => pane.id);
}

describe("reloading the whole wall after an import", () => {
  test("puts every pane that has an address back through a fetch", async () => {
    const store = useWallStore.getState();
    store.splitPane("root", "row");
    const ids = paneIds();
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      useWallStore.getState().submitUrl(id, `https://example.com/${id}`);
    }
    await settleAsyncWork();
    const afterOpening = probes.length;
    expect(afterOpening).toBe(2);

    reloadEveryPane();

    // Synchronously back to `probing`: that is the state change that takes an
    // iframe's `src` away, which is what makes the second fetch real.
    for (const id of ids) {
      expect(paneLoadState(useWallStore.getState(), id).kind).toBe("probing");
    }
    await settleAsyncWork();
    // One extra probe per pane, not one for the wall and not two per pane.
    expect(probes.length - afterOpening).toBe(2);
  });

  test("leaves a pane with no address alone", async () => {
    useWallStore.getState().splitPane("root", "row");
    const ids = paneIds();
    const [withUrl] = ids;
    if (withUrl === undefined) throw new Error("expected a pane");
    useWallStore.getState().submitUrl(withUrl, "https://example.com/");
    await settleAsyncWork();
    probes = [];

    reloadEveryPane();
    await settleAsyncWork();

    // The empty pane has nothing to refetch, so reloading it would only mean a
    // probe for `null`.
    expect(probes).toHaveLength(1);
    for (const id of ids) {
      if (id === withUrl) continue;
      expect(paneLoadState(useWallStore.getState(), id).kind).toBe("empty");
    }
  });
});
