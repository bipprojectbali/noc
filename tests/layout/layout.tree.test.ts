import { describe, expect, test } from "bun:test";

import {
  createTree,
  isDocked,
  listTreePaneIds,
  MIN_FRACTION,
  resizeSplit,
  setPaneUrl,
  splitPane,
} from "../../src/layout/layout.tree.ts";
import {
  deletePane,
  dockPane,
  undockPane,
} from "../../src/layout/layout.remove.ts";
import { assertWellFormed } from "../../src/layout/layout.invariants.ts";
import { isSplit } from "../../src/layout/layout.types.ts";

function idFactory(): () => string {
  let next = 0;
  return () => `n${++next}`;
}

describe("createTree", () => {
  test("starts as a single empty pane that is its own root", () => {
    const tree = createTree(idFactory(), 1000);
    expect(tree.rootId).toBe("n1");
    expect(tree.nodes.n1).toMatchObject({ kind: "pane", parentId: null, url: null });
    expect(tree.dock).toEqual([]);
    assertWellFormed(tree);
  });
});

describe("splitPane", () => {
  test("the split pane keeps its own id so the pane layer never sees it as new", () => {
    const makeId = idFactory();
    const tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);

    expect(tree.nodes.n1).toMatchObject({ kind: "pane", parentId: "n2" });
    expect(tree.rootId).toBe("n2");
    const root = tree.nodes.n2;
    expect(root && isSplit(root) && root.children).toEqual(["n1", "n3"]);
    expect(root && isSplit(root) && root.sizes).toEqual([0.5, 0.5]);
    assertWellFormed(tree);
  });

  test("nests splits and rewires the grandparent slot", () => {
    const makeId = idFactory();
    let tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
    tree = splitPane(tree, "n3", "column", makeId, 3);

    const root = tree.nodes.n2;
    expect(root && isSplit(root) && root.children).toEqual(["n1", "n4"]);
    const nested = tree.nodes.n4;
    expect(nested && isSplit(nested) && nested.children).toEqual(["n3", "n5"]);
    expect(listTreePaneIds(tree)).toEqual(["n1", "n3", "n5"]);
    assertWellFormed(tree);
  });

  test("preserves the url of the pane being split", () => {
    const makeId = idFactory();
    let tree = setPaneUrl(createTree(makeId, 1), "n1", "https://example.com/");
    tree = splitPane(tree, "n1", "row", makeId, 2);

    expect(tree.nodes.n1).toMatchObject({ url: "https://example.com/" });
    expect(tree.nodes.n3).toMatchObject({ url: null });
  });

  test("rejects an unknown pane id instead of silently doing nothing", () => {
    const makeId = idFactory();
    const tree = createTree(makeId, 1);
    expect(() => splitPane(tree, "nope", "row", makeId, 2)).toThrow(
      /Layout node "nope" does not exist/,
    );
  });

  test("rejects splitting a split node", () => {
    const makeId = idFactory();
    const tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
    expect(() => splitPane(tree, "n2", "row", makeId, 3)).toThrow(
      /is a split, not a pane/,
    );
  });
});

describe("deletePane", () => {
  test("promotes the sibling into the removed parent's slot", () => {
    const makeId = idFactory();
    let tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
    tree = deletePane(tree, "n3", makeId, 3);

    expect(tree.rootId).toBe("n1");
    expect(tree.nodes.n1).toMatchObject({ parentId: null });
    expect(tree.nodes.n2).toBeUndefined();
    expect(tree.nodes.n3).toBeUndefined();
    assertWellFormed(tree);
  });

  test("promotes a nested subtree, inheriting the parent's slot", () => {
    const makeId = idFactory();
    let tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
    tree = splitPane(tree, "n3", "column", makeId, 3);
    tree = deletePane(tree, "n1", makeId, 4);

    expect(tree.rootId).toBe("n4");
    expect(tree.nodes.n4).toMatchObject({ parentId: null });
    expect(listTreePaneIds(tree)).toEqual(["n3", "n5"]);
    assertWellFormed(tree);
  });

  test("deleting the last pane leaves one fresh empty pane", () => {
    const makeId = idFactory();
    let tree = setPaneUrl(createTree(makeId, 1), "n1", "https://example.com/");
    tree = deletePane(tree, "n1", makeId, 2);

    expect(tree.nodes.n1).toBeUndefined();
    expect(listTreePaneIds(tree)).toEqual(["n2"]);
    expect(tree.nodes.n2).toMatchObject({ kind: "pane", url: null, parentId: null });
    assertWellFormed(tree);
  });

  test("deletes a docked pane without touching the tree", () => {
    const makeId = idFactory();
    let tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
    tree = dockPane(tree, "n3", makeId, 3);
    tree = deletePane(tree, "n3", makeId, 4);

    expect(tree.dock).toEqual([]);
    expect(tree.nodes.n3).toBeUndefined();
    expect(tree.rootId).toBe("n1");
    assertWellFormed(tree);
  });
});

describe("dockPane and undockPane", () => {
  test("docking lifts the pane out of the tree but keeps its node alive", () => {
    const makeId = idFactory();
    let tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
    tree = setPaneUrl(tree, "n3", "https://info.cern.ch/");
    tree = dockPane(tree, "n3", makeId, 5);

    expect(isDocked(tree, "n3")).toBe(true);
    expect(tree.dock).toEqual([{ paneId: "n3", dockedAt: 5 }]);
    expect(tree.nodes.n3).toMatchObject({ url: "https://info.cern.ch/", parentId: null });
    expect(listTreePaneIds(tree)).toEqual(["n1"]);
    assertWellFormed(tree);
  });

  test("docking the only pane still leaves a pane in the tree", () => {
    const makeId = idFactory();
    const tree = dockPane(createTree(makeId, 1), "n1", makeId, 2);

    expect(isDocked(tree, "n1")).toBe(true);
    expect(listTreePaneIds(tree)).toEqual(["n2"]);
    assertWellFormed(tree);
  });

  test("docking twice is a no-op rather than a duplicate entry", () => {
    const makeId = idFactory();
    let tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
    tree = dockPane(tree, "n3", makeId, 3);
    const again = dockPane(tree, "n3", makeId, 4);

    expect(again).toBe(tree);
    expect(again.dock).toHaveLength(1);
  });

  test("undocking reinserts the pane by splitting the host", () => {
    const makeId = idFactory();
    let tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
    tree = setPaneUrl(tree, "n3", "https://www.wikipedia.org/");
    tree = dockPane(tree, "n3", makeId, 3);
    tree = undockPane(tree, "n3", "n1", "column", makeId);

    expect(tree.dock).toEqual([]);
    // The restored pane keeps its url: docking never destroyed it.
    expect(tree.nodes.n3).toMatchObject({ url: "https://www.wikipedia.org/" });
    expect(listTreePaneIds(tree)).toEqual(["n1", "n3"]);
    assertWellFormed(tree);
  });

  test("undocking a pane that is not docked is an explicit error", () => {
    const makeId = idFactory();
    const tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
    expect(() => undockPane(tree, "n3", "n1", "row", makeId)).toThrow(
      /is not docked/,
    );
  });

  test("a docked pane cannot host an undock", () => {
    const makeId = idFactory();
    let tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
    tree = dockPane(tree, "n1", makeId, 3);
    tree = dockPane(tree, "n3", makeId, 4);
    expect(() => undockPane(tree, "n3", "n1", "row", makeId)).toThrow(
      /is docked and cannot host/,
    );
  });
});

describe("resizeSplit", () => {
  test("writes complementary fractions", () => {
    const makeId = idFactory();
    let tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
    tree = resizeSplit(tree, "n2", 0.3);

    const split = tree.nodes.n2;
    expect(split && isSplit(split) && split.sizes).toEqual([0.3, 0.7]);
    assertWellFormed(tree);
  });

  test("clamps both ends to MIN_FRACTION so a pane cannot collapse away", () => {
    const makeId = idFactory();
    const base = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);

    const tooSmall = resizeSplit(base, "n2", -5);
    const tooLarge = resizeSplit(base, "n2", 42);
    const small = tooSmall.nodes.n2;
    const large = tooLarge.nodes.n2;

    // The complement is derived by subtraction, so the exact binary value is not
    // part of the contract; staying at or above MIN_FRACTION and summing to 1 is.
    for (const [node, expected] of [
      [small, [MIN_FRACTION, 1 - MIN_FRACTION]],
      [large, [1 - MIN_FRACTION, MIN_FRACTION]],
    ] as const) {
      if (node === undefined || !isSplit(node)) {
        throw new Error("expected a split node");
      }
      const [first, second] = node.sizes;
      expect(first).toBeCloseTo(expected[0], 12);
      expect(second).toBeCloseTo(expected[1], 12);
      expect(first).toBeGreaterThanOrEqual(MIN_FRACTION);
      expect(second).toBeGreaterThanOrEqual(MIN_FRACTION);
      expect(first + second).toBeCloseTo(1, 12);
    }
    assertWellFormed(tooSmall);
    assertWellFormed(tooLarge);
  });

  test("rejects resizing a pane node", () => {
    const makeId = idFactory();
    const tree = createTree(makeId, 1);
    expect(() => resizeSplit(tree, "n1", 0.5)).toThrow(/is a pane, not a split/);
  });
});
