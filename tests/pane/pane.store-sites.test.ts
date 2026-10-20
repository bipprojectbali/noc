/**
 * The store actions that decide which of a pane's pages is on screen.
 *
 * These are the four verbs the switcher and the ⋮ list are made of — add,
 * activate, next, remove — checked against the real store rather than a copy of
 * its logic, because what matters is what the renderers are then told.
 *
 * Two things are checked here that nothing in the UI can show: that there is
 * still only one address-validation path (a bad address rejects the same way
 * whether it was appending or repointing), and that load state is the *page's*
 * state — removing one site leaves every other site's state untouched.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { isPane, type PaneNode } from "../../src/layout/layout.types.ts";
import { paneLoadState, siteLoadState } from "../../src/pane/pane.store-sites.ts";
import { useWallStore } from "../../src/pane/pane.store.ts";
import { resetWallStore, settleAsyncWork } from "../fixtures/wall-store.ts";

const PANE = "s1";
const realFetch = globalThis.fetch;

function paneOf(paneId: string): PaneNode {
  const node = useWallStore.getState().tree.nodes[paneId];
  if (node === undefined || !isPane(node)) throw new Error("not a pane");
  return node;
}

function urls(paneId: string): string[] {
  return paneOf(paneId).sites.map((site) => site.url);
}

function activeUrl(paneId: string): string | null {
  const pane = paneOf(paneId);
  return pane.sites.find((site) => site.id === pane.activeSiteId)?.url ?? null;
}

beforeEach(() => {
  resetWallStore(PANE);
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ verdict: "allowed", reason: "no framing headers present" }),
      { headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
});

afterEach(async () => {
  await settleAsyncWork();
  globalThis.fetch = realFetch;
});

describe("a pane's list of pages", () => {
  test("the first address starts the list; the next ones lengthen it", () => {
    const store = () => useWallStore.getState();
    store().submitUrl(PANE, "https://one.example");
    store().addSite(PANE, "https://two.example");

    expect(urls(PANE)).toEqual(["https://one.example/", "https://two.example/"]);
    // Adding a page shows it: the user asked for this address, not for a
    // bookmark of it.
    expect(activeUrl(PANE)).toBe("https://two.example/");
  });

  test("an empty pane appends whatever it is asked, having nothing to repoint", () => {
    useWallStore.getState().addSite(PANE, "https://one.example");

    expect(urls(PANE)).toEqual(["https://one.example/"]);
  });

  test("the address bar repoints the page on screen instead of adding one", () => {
    const store = () => useWallStore.getState();
    store().submitUrl(PANE, "https://one.example");
    store().addSite(PANE, "https://two.example");
    const second = paneOf(PANE).activeSiteId;

    store().submitUrl(PANE, "https://moved.example");

    expect(urls(PANE)).toEqual(["https://one.example/", "https://moved.example/"]);
    // The same site, pointed somewhere else — not a third one.
    expect(paneOf(PANE).activeSiteId).toBe(second);
  });

  test("a bad address is refused the same way whichever verb asked", () => {
    const store = () => useWallStore.getState();
    store().submitUrl(PANE, "not a url");
    const fromSubmit = store().urlError[PANE];
    store().submitUrl(PANE, "https://one.example");

    store().addSite(PANE, "not a url");

    expect(fromSubmit).not.toBeNull();
    expect(store().urlError[PANE]).toBe(fromSubmit!);
    // And nothing was appended on the way to being told no.
    expect(urls(PANE)).toEqual(["https://one.example/"]);
  });

  test("every page keeps its own load state", async () => {
    const store = () => useWallStore.getState();
    store().submitUrl(PANE, "https://one.example");
    store().addSite(PANE, "https://two.example");
    const [first, second] = paneOf(PANE).sites;

    await settleAsyncWork();

    // `loading`, not `ready`: nothing is mounted here, so no frame ever
    // reports back. Both probes still landed on their own site.
    expect(siteLoadState(store(), first!.id)).toEqual({
      kind: "loading",
      url: "https://one.example/",
    });
    expect(siteLoadState(store(), second!.id)).toEqual({
      kind: "loading",
      url: "https://two.example/",
    });
    // What the pane is doing is what its active page is doing.
    expect(paneLoadState(store(), PANE)).toEqual(siteLoadState(store(), second!.id));
  });
});

describe("switching between the pages a pane holds", () => {
  function twoSites(): [string, string] {
    const store = () => useWallStore.getState();
    store().submitUrl(PANE, "https://one.example");
    store().addSite(PANE, "https://two.example");
    const [first, second] = paneOf(PANE).sites;
    return [first!.id, second!.id];
  }

  test("activate points the pane at a site it already holds", async () => {
    const [first] = twoSites();
    await settleAsyncWork();
    const before = useWallStore.getState().load;

    useWallStore.getState().activateSite(PANE, first);

    expect(activeUrl(PANE)).toBe("https://one.example/");
    // Switching is a tree write and nothing else: nothing reloaded, so not one
    // site's load state moved.
    expect(useWallStore.getState().load).toBe(before);
  });

  test("toggle advances through the list and wraps round", () => {
    twoSites();
    const toggle = () => useWallStore.getState().toggleSite(PANE);

    toggle();
    expect(activeUrl(PANE)).toBe("https://one.example/");
    toggle();
    expect(activeUrl(PANE)).toBe("https://two.example/");
  });

  test("a site that is no longer there, and a pane that never was, change nothing", () => {
    const [, second] = twoSites();
    const before = useWallStore.getState().tree;

    // A control can be clicked a frame after what it names was removed.
    useWallStore.getState().activateSite(PANE, "gone");
    useWallStore.getState().activateSite("no-such-pane", second);
    useWallStore.getState().toggleSite("no-such-pane");

    expect(useWallStore.getState().tree).toBe(before);
  });
});

describe("dropping one of a pane's pages", () => {
  test("removing the page on screen falls to its neighbour and forgets only it", async () => {
    const store = () => useWallStore.getState();
    store().submitUrl(PANE, "https://one.example");
    store().addSite(PANE, "https://two.example");
    const [first, second] = paneOf(PANE).sites.map((site) => site.id);
    await settleAsyncWork();

    store().removeSite(PANE, second!);

    expect(urls(PANE)).toEqual(["https://one.example/"]);
    expect(activeUrl(PANE)).toBe("https://one.example/");
    expect(store().load[second!]).toBeUndefined();
    // The page that stayed is untouched — this is a removal, not a reset.
    expect(siteLoadState(store(), first!)).toEqual({
      kind: "loading",
      url: "https://one.example/",
    });
  });

  test("removing the last page leaves the pane, empty", () => {
    const store = () => useWallStore.getState();
    store().submitUrl(PANE, "https://one.example");
    const only = paneOf(PANE).activeSiteId!;

    store().removeSite(PANE, only);

    expect(paneOf(PANE).sites).toEqual([]);
    expect(paneOf(PANE).activeSiteId).toBeNull();
    expect(paneLoadState(store(), PANE)).toEqual({ kind: "empty" });
  });

  test("a site that belongs to no pane is not removed from the one asked", () => {
    const store = () => useWallStore.getState();
    store().submitUrl(PANE, "https://one.example");
    const before = store().tree;

    store().removeSite(PANE, "gone");
    store().removeSite("no-such-pane", paneOf(PANE).activeSiteId!);

    expect(store().tree).toBe(before);
  });
});
