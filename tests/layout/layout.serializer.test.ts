import { describe, expect, test } from "bun:test";

import {
  CURRENT_LAYOUT_VERSION,
  parseLayout,
  serializeLayout,
} from "../../src/layout/layout.serializer.ts";
import { createTree, splitPane } from "../../src/layout/layout.tree.ts";
import { dockPane } from "../../src/layout/layout.remove.ts";
import { findViolations } from "../../src/layout/layout.invariants.ts";
import { setSiteZoom } from "../../src/layout/layout.sites.ts";
import {
  isPane,
  type LayoutTree,
  type PaneNode,
} from "../../src/layout/layout.types.ts";
import { seedUrl } from "../fixtures/pane-sites.ts";

function sampleTree() {
  let counter = 0;
  const makeId = () => `n${++counter}`;
  let tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
  tree = splitPane(tree, "n3", "column", makeId, 3);
  tree = seedUrl(tree, "n1", "https://example.com/");
  tree = dockPane(tree, "n5", makeId, 4);
  return tree;
}

describe("serializeLayout and parseLayout", () => {
  test("roundtrips a tree through JSON unchanged", () => {
    const tree = sampleTree();
    const restored = parseLayout(JSON.parse(JSON.stringify(serializeLayout(tree))));
    expect(restored).toEqual(tree);
  });

  test("stamps the current version", () => {
    expect(serializeLayout(sampleTree()).version).toBe(CURRENT_LAYOUT_VERSION);
  });

  test("rejects a payload that is not a versioned layout", () => {
    expect(() => parseLayout({ tree: sampleTree() })).toThrow(
      /not a versioned layout payload/,
    );
    expect(() => parseLayout(null)).toThrow(/not a versioned layout payload/);
    expect(() => parseLayout("{}")).toThrow(/not a versioned layout payload/);
  });

  test("refuses a layout written by a newer version instead of guessing", () => {
    const payload = { version: CURRENT_LAYOUT_VERSION + 1, tree: sampleTree() };
    expect(() => parseLayout(payload)).toThrow(/is newer than supported version/);
  });

  test("refuses an older version with no registered migration", () => {
    // Version 0 never existed, so nothing can read it: an unknown old shape is
    // refused rather than hopefully handed to the checks.
    const payload = { version: 0, tree: sampleTree() };
    expect(() => parseLayout(payload)).toThrow(/No migration registered/);
  });

  test("refuses a stored tree that is structurally broken", () => {
    const tree = sampleTree();
    const payload = {
      version: CURRENT_LAYOUT_VERSION,
      tree: { ...tree, rootId: "gone" },
    };
    expect(() => parseLayout(payload)).toThrow(/Malformed layout tree/);
  });
});

/**
 * Written out by hand rather than built from the current code, because that is
 * the point: this is the shape already sitting in a user's database, and it has
 * to keep opening after a pane learned to hold several addresses.
 */
const V1_PAYLOAD = {
  version: 1,
  tree: {
    rootId: "root",
    nodes: {
      root: {
        id: "root",
        kind: "split",
        parentId: null,
        direction: "row",
        children: ["left", "right"],
        sizes: [0.6, 0.4],
      },
      left: {
        id: "left",
        kind: "pane",
        parentId: "root",
        url: "https://info.cern.ch/",
        urlBarVisible: true,
        strategy: "webview",
        createdAt: 1,
      },
      right: {
        id: "right",
        kind: "pane",
        parentId: "root",
        url: null,
        urlBarVisible: false,
        strategy: "auto",
        createdAt: 2,
      },
      stowed: {
        id: "stowed",
        kind: "pane",
        parentId: null,
        url: "https://example.com/",
        urlBarVisible: true,
        strategy: "iframe",
        createdAt: 3,
      },
    },
    dock: [{ paneId: "stowed", dockedAt: 9 }],
  },
};

describe("migrating a version 1 layout", () => {
  test("turns the pane's single url into one site, shown", () => {
    const tree = parseLayout(structuredClone(V1_PAYLOAD));
    expect(tree.nodes.left).toEqual({
      id: "left",
      kind: "pane",
      parentId: "root",
      // Version 1 knew nothing about magnification, so the 2 → 3 step gives the
      // site it just built the ordinary size.
      sites: [
        { id: "left-s1", url: "https://info.cern.ch/", createdAt: 1, zoom: 1 },
      ],
      activeSiteId: "left-s1",
      urlBarVisible: true,
      strategy: "webview",
      createdAt: 1,
    });
  });

  test("a pane that had no url comes back empty, not holding a null site", () => {
    const tree = parseLayout(structuredClone(V1_PAYLOAD));
    expect(tree.nodes.right).toMatchObject({ sites: [], activeSiteId: null });
  });

  test("docked panes migrate too: they are alive, just not on the wall", () => {
    const tree = parseLayout(structuredClone(V1_PAYLOAD));
    expect(tree.nodes.stowed).toMatchObject({
      sites: [{ id: "stowed-s1", url: "https://example.com/", createdAt: 3 }],
      activeSiteId: "stowed-s1",
    });
    expect(tree.dock).toEqual([{ paneId: "stowed", dockedAt: 9 }]);
  });

  test("splits and sizes are carried over untouched", () => {
    const tree = parseLayout(structuredClone(V1_PAYLOAD));
    expect(tree.nodes.root).toEqual(V1_PAYLOAD.tree.nodes.root as never);
  });

  test("site ids are derived, so the same stored layout names them the same twice", () => {
    const once = parseLayout(structuredClone(V1_PAYLOAD));
    const twice = parseLayout(structuredClone(V1_PAYLOAD));
    expect(once).toEqual(twice);
  });

  test("the migrated tree is well formed and stamps as current", () => {
    const tree = parseLayout(structuredClone(V1_PAYLOAD));
    expect(findViolations(tree)).toEqual([]);
    expect(serializeLayout(tree).version).toBe(CURRENT_LAYOUT_VERSION);
  });
});

/**
 * The shape sitting in a database written before a page could be magnified.
 * Hand-written for the same reason the version 1 payload is: what matters is
 * that the file already out there keeps opening.
 */
const V2_PAYLOAD = {
  version: 2,
  tree: {
    rootId: "solo",
    nodes: {
      solo: {
        id: "solo",
        kind: "pane",
        parentId: null,
        sites: [
          { id: "solo-s1", url: "https://info.cern.ch/", createdAt: 1 },
          { id: "solo-s2", url: "https://example.com/", createdAt: 2 },
        ],
        activeSiteId: "solo-s2",
        urlBarVisible: true,
        strategy: "auto",
        createdAt: 1,
      },
    },
    dock: [],
  },
};

/** The one pane of the version 2 payload, typed. */
function soloPane(tree: LayoutTree): PaneNode {
  const node = tree.nodes.solo;
  if (node === undefined || !isPane(node)) throw new Error("no pane 'solo'");
  return node;
}

describe("migrating a version 2 layout", () => {
  test("every site comes back at the ordinary size", () => {
    const tree = parseLayout(structuredClone(V2_PAYLOAD));
    expect(soloPane(tree).sites).toEqual([
      { id: "solo-s1", url: "https://info.cern.ch/", createdAt: 1, zoom: 1 },
      { id: "solo-s2", url: "https://example.com/", createdAt: 2, zoom: 1 },
    ]);
    // A wall restored from this must pass the same checks as any other, or the
    // whole layout is refused at startup and the operator loses it.
    expect(findViolations(tree)).toEqual([]);
    expect(serializeLayout(tree).version).toBe(CURRENT_LAYOUT_VERSION);
  });

  test("a stored zoom survives the round trip it was written for", () => {
    const tree = parseLayout(structuredClone(V2_PAYLOAD));
    const magnified = setSiteZoom(tree, "solo", "solo-s1", 1.5);
    const restored = parseLayout(
      JSON.parse(JSON.stringify(serializeLayout(magnified))),
    );
    expect(soloPane(restored).sites.map((site) => site.zoom)).toEqual([1.5, 1]);
  });

  test("a zoom no renderer could honour is pulled back rather than refused", () => {
    // A hand-edited file, or one written by a build with a longer ladder. The
    // alternative is `assertWellFormed` throwing out the entire wall.
    const payload = structuredClone(V2_PAYLOAD) as {
      version: number;
      tree: { nodes: Record<string, { sites: { zoom?: unknown }[] }> };
    };
    const sites = payload.tree.nodes.solo?.sites ?? [];
    if (sites[0] !== undefined) sites[0].zoom = 40;
    if (sites[1] !== undefined) sites[1].zoom = "big";
    const tree = parseLayout(payload);
    expect(soloPane(tree).sites.map((site) => site.zoom)).toEqual([1, 1]);
  });
});
