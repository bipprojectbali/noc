import { describe, expect, test } from "bun:test";

import { assertWellFormed } from "../../src/layout/layout.invariants.ts";
import {
  movePane,
  swapPanes,
  type RearrangeResult,
} from "../../src/layout/layout.move.ts";
import { dockPane } from "../../src/layout/layout.remove.ts";
import {
  createTree,
  listTreePaneIds,
  resizeSplit,
  splitPane,
} from "../../src/layout/layout.tree.ts";
import { isPane, isSplit, type LayoutTree } from "../../src/layout/layout.types.ts";
import { paneUrl, seedUrl } from "../fixtures/pane-sites.ts";

function idFactory(): () => string {
  let next = 0;
  return () => `n${++next}`;
}

function paneIds(tree: LayoutTree): string[] {
  return Object.values(tree.nodes)
    .filter((node) => isPane(node))
    .map((node) => node.id)
    .sort();
}

function childrenOf(tree: LayoutTree, splitId: string): string[] {
  const node = tree.nodes[splitId];
  if (node === undefined || !isSplit(node)) {
    throw new Error(`"${splitId}" is not a split`);
  }
  return [...node.children];
}

function unwrap(result: RearrangeResult): LayoutTree {
  if (!result.ok) throw new Error(`expected ok, got "${result.reason}"`);
  return result.tree;
}

/** n1 | (n3 / n5): a row whose right half is a column of two panes. */
function threePaneWall(): { tree: LayoutTree; makeId: () => string } {
  const makeId = idFactory();
  let tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
  tree = splitPane(tree, "n3", "column", makeId, 3);
  return { tree, makeId };
}

describe("movePane", () => {
  test("keeps every pane id: the moved pane is the same node, never a new one", () => {
    const { tree: base, makeId } = threePaneWall();
    const before = paneIds(base);

    const tree = unwrap(movePane(base, "n5", "n1", "left", makeId));

    expect(paneIds(tree)).toEqual(before);
    expect(tree.nodes.n5).toMatchObject({ kind: "pane", createdAt: 3 });
    assertWellFormed(tree);
  });

  test("carries the pane's url across the move", () => {
    const { tree: base, makeId } = threePaneWall();
    const withUrl = seedUrl(base, "n5", "https://info.cern.ch/");

    const tree = unwrap(movePane(withUrl, "n5", "n1", "top", makeId));

    expect(paneUrl(tree, "n5")).toBe("https://info.cern.ch/");
  });

  test("collapses the split the pane left behind, promoting its sibling", () => {
    const { tree: base, makeId } = threePaneWall();

    const tree = unwrap(movePane(base, "n5", "n1", "left", makeId));

    // n4 held n3 and n5; with n5 gone, n3 takes n4's slot under the root.
    expect(tree.nodes.n4).toBeUndefined();
    expect(childrenOf(tree, "n2")).toEqual(["n6", "n3"]);
    expect(tree.nodes.n3).toMatchObject({ parentId: "n2" });
    assertWellFormed(tree);
  });

  test("each side picks the direction and the child slot", () => {
    for (const [side, direction, children] of [
      ["left", "row", ["n5", "n1"]],
      ["right", "row", ["n1", "n5"]],
      ["top", "column", ["n5", "n1"]],
      ["bottom", "column", ["n1", "n5"]],
    ] as const) {
      const { tree: base, makeId } = threePaneWall();
      const tree = unwrap(movePane(base, "n5", "n1", side, makeId));
      const split = tree.nodes.n6;
      if (split === undefined || !isSplit(split)) throw new Error("no split");

      expect(split.direction).toBe(direction);
      expect(split.children).toEqual([...children]);
      assertWellFormed(tree);
    }
  });

  test("the new split inherits the target's slot, but the pair starts even", () => {
    const { tree: base, makeId } = threePaneWall();
    const sized = resizeSplit(base, "n2", 0.2);

    const tree = unwrap(movePane(sized, "n5", "n1", "left", makeId));

    // n1's slot in the root keeps its 0.2 share; the pane pair inside splits it.
    const root = tree.nodes.n2;
    const fresh = tree.nodes.n6;
    if (root === undefined || !isSplit(root)) throw new Error("no root split");
    if (fresh === undefined || !isSplit(fresh)) throw new Error("no new split");
    expect(root.sizes[0]).toBeCloseTo(0.2, 12);
    expect(fresh.sizes).toEqual([0.5, 0.5]);
    assertWellFormed(tree);
  });

  test("moving next to the sibling it already shares a split with reorders it", () => {
    const { tree: base, makeId } = threePaneWall();

    const tree = unwrap(movePane(base, "n5", "n3", "top", makeId));

    expect(listTreePaneIds(tree)).toEqual(["n1", "n3", "n5"]);
    expect(childrenOf(tree, "n6")).toEqual(["n5", "n3"]);
    assertWellFormed(tree);
  });

  test("moving a pane onto itself is a no-op, not an error", () => {
    const { tree: base, makeId } = threePaneWall();

    const result = movePane(base, "n5", "n5", "left", makeId);

    expect(result.ok).toBe(true);
    expect(unwrap(result)).toBe(base);
  });

  test("the only pane on the wall can only be moved onto itself", () => {
    const makeId = idFactory();
    const tree = createTree(makeId, 1);

    expect(unwrap(movePane(tree, "n1", "n1", "right", makeId))).toBe(tree);
    // Nothing else exists to be a target, so unknown ids still throw.
    expect(() => movePane(tree, "n1", "ghost", "right", makeId)).toThrow(
      /does not exist/,
    );
  });

  test("refuses a docked pane on either end instead of silently undocking", () => {
    const { tree: base, makeId } = threePaneWall();
    const docked = dockPane(base, "n5", makeId, 4);

    expect(movePane(docked, "n5", "n1", "left", makeId)).toEqual({
      ok: false,
      reason: "pane-docked",
    });
    expect(movePane(docked, "n1", "n5", "left", makeId)).toEqual({
      ok: false,
      reason: "pane-docked",
    });
    // The refusal is pure: the tree it was handed is untouched.
    assertWellFormed(docked);
  });

  test("rejects unknown ids and split ids rather than doing nothing", () => {
    const { tree: base, makeId } = threePaneWall();

    expect(() => movePane(base, "ghost", "n1", "left", makeId)).toThrow(
      /does not exist/,
    );
    expect(() => movePane(base, "n5", "n2", "left", makeId)).toThrow(
      /is a split, not a pane/,
    );
  });
});

describe("swapPanes", () => {
  test("exchanges two slots without touching the shape of the tree", () => {
    const { tree: base } = threePaneWall();
    const before = paneIds(base);

    const tree = unwrap(swapPanes(base, "n1", "n5"));

    expect(paneIds(tree)).toEqual(before);
    expect(Object.keys(tree.nodes).sort()).toEqual(
      Object.keys(base.nodes).sort(),
    );
    expect(childrenOf(tree, "n2")).toEqual(["n5", "n4"]);
    expect(childrenOf(tree, "n4")).toEqual(["n3", "n1"]);
    expect(tree.nodes.n1).toMatchObject({ parentId: "n4" });
    expect(tree.nodes.n5).toMatchObject({ parentId: "n2" });
    assertWellFormed(tree);
  });

  test("swapping siblings flips one split and leaves its sizes in place", () => {
    const { tree: base } = threePaneWall();
    const sized = resizeSplit(base, "n4", 0.3);

    const tree = unwrap(swapPanes(sized, "n3", "n5"));

    const split = tree.nodes.n4;
    if (split === undefined || !isSplit(split)) throw new Error("no split");
    expect(split.children).toEqual(["n5", "n3"]);
    // Sizes belong to the slots, so the panes trade shares along with places.
    expect(split.sizes[0]).toBeCloseTo(0.3, 12);
    assertWellFormed(tree);
  });

  test("swapping is its own inverse", () => {
    const { tree: base } = threePaneWall();

    const there = unwrap(swapPanes(base, "n1", "n5"));
    const back = unwrap(swapPanes(there, "n1", "n5"));

    expect(back).toEqual(base);
  });

  test("carries each pane's url with it", () => {
    const { tree: base } = threePaneWall();
    let seeded = seedUrl(base, "n1", "https://a.example/");
    seeded = seedUrl(seeded, "n5", "https://b.example/");

    const tree = unwrap(swapPanes(seeded, "n1", "n5"));

    expect(paneUrl(tree, "n1")).toBe("https://a.example/");
    expect(paneUrl(tree, "n5")).toBe("https://b.example/");
  });

  test("swapping a pane with itself is a no-op", () => {
    const { tree: base } = threePaneWall();

    expect(unwrap(swapPanes(base, "n3", "n3"))).toBe(base);
  });

  test("the only pane on the wall has nobody to swap with", () => {
    const makeId = idFactory();
    const tree = createTree(makeId, 1);

    expect(unwrap(swapPanes(tree, "n1", "n1"))).toBe(tree);
    expect(() => swapPanes(tree, "n1", "ghost")).toThrow(/does not exist/);
  });

  test("refuses a docked pane on either end", () => {
    const { tree: base, makeId } = threePaneWall();
    const docked = dockPane(base, "n5", makeId, 4);

    expect(swapPanes(docked, "n5", "n1")).toEqual({
      ok: false,
      reason: "pane-docked",
    });
    expect(swapPanes(docked, "n1", "n5")).toEqual({
      ok: false,
      reason: "pane-docked",
    });
  });

  test("rejects a split id rather than swapping subtrees by accident", () => {
    const { tree: base } = threePaneWall();

    expect(() => swapPanes(base, "n1", "n4")).toThrow(/is a split, not a pane/);
  });
});
