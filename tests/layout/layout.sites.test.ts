import { describe, expect, test } from "bun:test";

import { assertWellFormed, findViolations } from "../../src/layout/layout.invariants.ts";
import {
  activePaneUrl,
  addSite,
  nextSiteId,
  removeSite,
  setActiveSite,
  setSiteUrl,
} from "../../src/layout/layout.sites.ts";
import {
  createTree,
  setPaneUrl,
  splitPane,
} from "../../src/layout/layout.tree.ts";
import {
  isPane,
  type LayoutTree,
  type PaneNode,
} from "../../src/layout/layout.types.ts";

function idFactory(): () => string {
  let next = 0;
  return () => `n${++next}`;
}

function pane(tree: LayoutTree, paneId: string): PaneNode {
  const node = tree.nodes[paneId];
  if (node === undefined || !isPane(node)) throw new Error(`no pane ${paneId}`);
  return node;
}

/** One pane holding three addresses, added in the order a, b, c. */
function threeSites(): LayoutTree {
  const makeId = idFactory();
  let tree = createTree(makeId, 1);
  let site = 0;
  const nextId = () => `s${++site}`;
  tree = addSite(tree, "n1", "https://a.example/", nextId, 10);
  tree = addSite(tree, "n1", "https://b.example/", nextId, 11);
  tree = addSite(tree, "n1", "https://c.example/", nextId, 12);
  return tree;
}

describe("addSite", () => {
  test("appends and shows the new address", () => {
    const tree = threeSites();
    expect(pane(tree, "n1").sites.map((site) => site.url)).toEqual([
      "https://a.example/",
      "https://b.example/",
      "https://c.example/",
    ]);
    expect(activePaneUrl(pane(tree, "n1"))).toBe("https://c.example/");
    assertWellFormed(tree);
  });

  test("keeps creation order: an addition never moves the sites already there", () => {
    const before = pane(threeSites(), "n1").sites.slice(0, 2);
    const after = addSite(threeSites(), "n1", "https://d.example/", () => "s9", 13);
    expect(pane(after, "n1").sites.slice(0, 2)).toEqual(before);
  });

  test("allows the same url twice, because two views of one dashboard is a real want", () => {
    let tree = addSite(createTree(idFactory(), 1), "n1", "https://a.example/", () => "s1", 10);
    tree = addSite(tree, "n1", "https://a.example/", () => "s2", 11);
    expect(pane(tree, "n1").sites).toHaveLength(2);
    expect(pane(tree, "n1").activeSiteId).toBe("s2");
    assertWellFormed(tree);
  });

  test("refuses an id that is not a pane", () => {
    const makeId = idFactory();
    const tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
    expect(() => addSite(tree, "n2", "https://a.example/", () => "s1", 3)).toThrow(
      /is a split, not a pane/,
    );
  });
});

describe("removeSite", () => {
  test("closing the active site falls to the one that took its place", () => {
    const tree = removeSite(threeSites(), "n1", "s3");
    // s3 was last, so the fallback is the new last one.
    expect(pane(tree, "n1").activeSiteId).toBe("s2");

    const middle = setActiveSite(threeSites(), "n1", "s2");
    expect(pane(removeSite(middle, "n1", "s2"), "n1").activeSiteId).toBe("s3");
  });

  test("closing a background site leaves the active one alone", () => {
    const tree = removeSite(threeSites(), "n1", "s1");
    expect(pane(tree, "n1").activeSiteId).toBe("s3");
    expect(pane(tree, "n1").sites.map((site) => site.id)).toEqual(["s2", "s3"]);
  });

  test("closing the last site empties the pane instead of deleting it", () => {
    let tree = addSite(createTree(idFactory(), 1), "n1", "https://a.example/", () => "s1", 10);
    tree = removeSite(tree, "n1", "s1");
    expect(pane(tree, "n1").sites).toEqual([]);
    expect(pane(tree, "n1").activeSiteId).toBeNull();
    expect(activePaneUrl(pane(tree, "n1"))).toBeNull();
    assertWellFormed(tree);
  });

  test("refuses a site the pane does not hold", () => {
    expect(() => removeSite(threeSites(), "n1", "s9")).toThrow(/has no site "s9"/);
  });
});

describe("setActiveSite and setSiteUrl", () => {
  test("switching changes what shows and nothing else", () => {
    const before = threeSites();
    const tree = setActiveSite(before, "n1", "s1");
    expect(activePaneUrl(pane(tree, "n1"))).toBe("https://a.example/");
    expect(pane(tree, "n1").sites).toEqual(pane(before, "n1").sites);
  });

  test("retargeting a site keeps its id and its place in the list", () => {
    const tree = setSiteUrl(threeSites(), "n1", "s1", "https://moved.example/");
    expect(pane(tree, "n1").sites[0]).toMatchObject({
      id: "s1",
      url: "https://moved.example/",
      createdAt: 10,
    });
    expect(pane(tree, "n1").activeSiteId).toBe("s3");
  });

  test("both refuse a site the pane does not hold", () => {
    expect(() => setActiveSite(threeSites(), "n1", "s9")).toThrow(/has no site/);
    expect(() => setSiteUrl(threeSites(), "n1", "s9", "https://x.example/")).toThrow(
      /has no site/,
    );
  });
});

describe("nextSiteId", () => {
  test("walks forward and wraps at the end", () => {
    const tree = threeSites();
    expect(nextSiteId(pane(tree, "n1"))).toBe("s1");
    expect(nextSiteId(pane(setActiveSite(tree, "n1", "s1"), "n1"))).toBe("s2");
  });

  test("a pane with one site answers with that site, so callers need no branch", () => {
    const tree = addSite(createTree(idFactory(), 1), "n1", "https://a.example/", () => "s1", 10);
    expect(nextSiteId(pane(tree, "n1"))).toBe("s1");
  });

  test("an empty pane has nowhere to go", () => {
    expect(nextSiteId(pane(createTree(idFactory(), 1), "n1"))).toBeNull();
  });
});

describe("setPaneUrl keeps meaning one address per pane", () => {
  test("rewrites the active site in place", () => {
    const tree = setPaneUrl(threeSites(), "n1", "https://new.example/");
    expect(pane(tree, "n1").sites.map((site) => site.url)).toEqual([
      "https://a.example/",
      "https://b.example/",
      "https://new.example/",
    ]);
  });

  test("null closes the active site, which empties a pane that held only one", () => {
    let tree = addSite(createTree(idFactory(), 1), "n1", "https://a.example/", () => "s1", 10);
    tree = setPaneUrl(tree, "n1", null);
    expect(pane(tree, "n1").sites).toEqual([]);
    expect(pane(tree, "n1").activeSiteId).toBeNull();
  });

  test("clearing an already-empty pane is a no-op, not an error", () => {
    const tree = createTree(idFactory(), 1);
    expect(setPaneUrl(tree, "n1", null)).toBe(tree);
  });

  test("a pane with no site cannot be repointed: its first address is addSite", () => {
    const tree = createTree(idFactory(), 1);
    expect(() => setPaneUrl(tree, "n1", "https://a.example/")).toThrow(
      /has no site to point at/,
    );
  });
});

describe("findViolations detects hand-made site corruption", () => {
  test("flags an active site the pane does not hold", () => {
    const tree = threeSites();
    const broken: LayoutTree = {
      ...tree,
      nodes: { ...tree.nodes, n1: { ...pane(tree, "n1"), activeSiteId: "ghost" } },
    };
    expect(findViolations(broken)).toEqual([
      expect.stringContaining('is active on "ghost"'),
    ]);
  });

  test("flags a pane holding sites with nothing active", () => {
    const tree = threeSites();
    const broken: LayoutTree = {
      ...tree,
      nodes: { ...tree.nodes, n1: { ...pane(tree, "n1"), activeSiteId: null } },
    };
    expect(findViolations(broken)).toEqual([
      expect.stringContaining('is active on "null"'),
    ]);
  });

  test("flags an empty pane that still claims an active site", () => {
    const tree = createTree(idFactory(), 1);
    const broken: LayoutTree = {
      ...tree,
      nodes: { ...tree.nodes, n1: { ...pane(tree, "n1"), activeSiteId: "ghost" } },
    };
    expect(findViolations(broken)).toEqual([
      expect.stringContaining("holds no sites but is active"),
    ]);
  });

  test("flags a site id reused by another pane, because ids are wall-wide", () => {
    const makeId = idFactory();
    let tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
    tree = addSite(tree, "n1", "https://a.example/", () => "same", 10);
    tree = addSite(tree, "n3", "https://b.example/", () => "same", 11);
    expect(findViolations(tree)).toEqual([
      expect.stringContaining('site "same" appears more than once'),
    ]);
  });

  test("flags a pane whose site list is not a list, rather than throwing on it", () => {
    const tree = createTree(idFactory(), 1);
    const broken = {
      ...tree,
      nodes: { ...tree.nodes, n1: { ...pane(tree, "n1"), sites: undefined } },
    } as unknown as LayoutTree;
    expect(findViolations(broken)).toEqual([
      expect.stringContaining("has no site list"),
    ]);
  });
});
