import { describe, expect, test } from "bun:test";

import { findViolations } from "../../src/layout/layout.invariants.ts";
import {
  createTree,
  listTreePaneIds,
  resizeSplit,
  splitPane,
} from "../../src/layout/layout.tree.ts";
import {
  deletePane,
  dockPane,
  undockPane,
} from "../../src/layout/layout.remove.ts";
import { movePane, swapPanes } from "../../src/layout/layout.move.ts";
import {
  isPane,
  isSplit,
  type LayoutTree,
  type PaneSide,
} from "../../src/layout/layout.types.ts";

const SEED_COUNT = 200;
const OPS_PER_SEED = 40;

/** Deterministic PRNG so a failing case can be replayed from its seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(random() * items.length)];
}

function splitIds(tree: LayoutTree): string[] {
  return Object.values(tree.nodes)
    .filter((node) => isSplit(node))
    .map((node) => node.id);
}

/** Every pane node that exists, in the tree or in the dock. */
function allPaneIds(tree: LayoutTree): string[] {
  return Object.values(tree.nodes)
    .filter((node) => isPane(node))
    .map((node) => node.id)
    .sort();
}

const SIDES: readonly PaneSide[] = ["left", "right", "top", "bottom"];

type Step = { op: string; args: string[] };

/** Applies one random operation. Returns the same tree when the op does not apply. */
function applyRandomOp(
  tree: LayoutTree,
  random: () => number,
  makeId: () => string,
  now: number,
): { tree: LayoutTree; step: Step } {
  const treePanes = listTreePaneIds(tree);
  const docked = tree.dock.map((entry) => entry.paneId);
  const ops = [
    "split",
    "delete",
    "dock",
    "undock",
    "resize",
    "move",
    "swap",
  ] as const;
  const op = ops[Math.floor(random() * ops.length)] ?? "split";
  const direction = random() < 0.5 ? "row" : "column";
  const side = SIDES[Math.floor(random() * SIDES.length)] ?? "left";

  switch (op) {
    case "split": {
      const target = pick(random, treePanes);
      if (target === undefined) break;
      return {
        tree: splitPane(tree, target, direction, makeId, now),
        step: { op, args: [target, direction] },
      };
    }
    case "delete": {
      const target = pick(random, [...treePanes, ...docked]);
      if (target === undefined) break;
      return {
        tree: deletePane(tree, target, makeId, now),
        step: { op, args: [target] },
      };
    }
    case "dock": {
      const target = pick(random, treePanes);
      if (target === undefined) break;
      return {
        tree: dockPane(tree, target, makeId, now),
        step: { op, args: [target] },
      };
    }
    case "undock": {
      const target = pick(random, docked);
      const host = pick(random, treePanes);
      if (target === undefined || host === undefined) break;
      return {
        tree: undockPane(tree, target, host, direction, makeId),
        step: { op, args: [target, host, direction] },
      };
    }
    // Move and swap draw from docked panes too, so the refusal paths are
    // exercised as hard as the structural ones.
    case "move": {
      const source = pick(random, [...treePanes, ...docked]);
      const target = pick(random, [...treePanes, ...docked]);
      if (source === undefined || target === undefined) break;
      const result = movePane(tree, source, target, side, makeId);
      return {
        tree: result.ok ? result.tree : tree,
        step: { op: result.ok ? op : `${op}:refused`, args: [source, target, side] },
      };
    }
    case "swap": {
      const source = pick(random, [...treePanes, ...docked]);
      const target = pick(random, [...treePanes, ...docked]);
      if (source === undefined || target === undefined) break;
      const result = swapPanes(tree, source, target);
      return {
        tree: result.ok ? result.tree : tree,
        step: { op: result.ok ? op : `${op}:refused`, args: [source, target] },
      };
    }
    case "resize": {
      const target = pick(random, splitIds(tree));
      if (target === undefined) break;
      const fraction = random() * 2 - 0.5;
      return {
        tree: resizeSplit(tree, target, fraction),
        step: { op, args: [target, String(fraction)] },
      };
    }
  }
  return { tree, step: { op: `${op}:skipped`, args: [] } };
}

describe("tree invariants hold under arbitrary operation sequences", () => {
  test(`${SEED_COUNT} seeds x ${OPS_PER_SEED} random ops leave a well-formed tree`, () => {
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const random = mulberry32(seed);
      let counter = 0;
      const makeId = () => `n${++counter}`;
      let tree = createTree(makeId, 0);
      const history: Step[] = [];

      for (let i = 0; i < OPS_PER_SEED; i++) {
        const panesBefore = allPaneIds(tree);
        const result = applyRandomOp(tree, random, makeId, i + 1);
        tree = result.tree;
        history.push(result.step);

        // Rearranging must never mint or drop a pane id: a new id is a new
        // pane to the pane layer, which means a remount and a page reload.
        if (result.step.op === "move" || result.step.op === "swap") {
          expect(allPaneIds(tree)).toEqual(panesBefore);
        }

        const violations = findViolations(tree);
        if (violations.length > 0) {
          const trail = history
            .map((step) => `${step.op}(${step.args.join(", ")})`)
            .join(" -> ");
          throw new Error(
            `seed ${seed} step ${i}: ${violations.join("; ")}\nhistory: ${trail}`,
          );
        }
        expect(listTreePaneIds(tree).length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("rearranging alone never changes which panes exist", () => {
  test(`${SEED_COUNT} seeds of move/swap only keep the pane set and the tree intact`, () => {
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const random = mulberry32(seed);
      let counter = 0;
      const makeId = () => `n${++counter}`;

      // Grow a wall first; move and swap can only shuffle what is already there.
      let tree = createTree(makeId, 0);
      for (let i = 0; i < 6; i++) {
        const target = pick(random, listTreePaneIds(tree));
        if (target === undefined) continue;
        tree = splitPane(tree, target, random() < 0.5 ? "row" : "column", makeId, i + 1);
      }

      const panes = allPaneIds(tree);
      const history: Step[] = [];

      for (let i = 0; i < OPS_PER_SEED; i++) {
        const swapOnly = random() < 0.5;
        const panesNow = listTreePaneIds(tree);
        const a = pick(random, panesNow);
        const b = pick(random, panesNow);
        if (a === undefined || b === undefined) continue;
        const side = SIDES[Math.floor(random() * SIDES.length)] ?? "left";

        const result = swapOnly
          ? swapPanes(tree, a, b)
          : movePane(tree, a, b, side, makeId);
        history.push({
          op: swapOnly ? "swap" : "move",
          args: swapOnly ? [a, b] : [a, b, side],
        });
        if (!result.ok) {
          throw new Error(`seed ${seed} step ${i}: refused with "${result.reason}"`);
        }
        tree = result.tree;

        const violations = findViolations(tree);
        if (violations.length > 0) {
          const trail = history
            .map((step) => `${step.op}(${step.args.join(", ")})`)
            .join(" -> ");
          throw new Error(
            `seed ${seed} step ${i}: ${violations.join("; ")}\nhistory: ${trail}`,
          );
        }
        expect(allPaneIds(tree)).toEqual(panes);
      }
    }
  });
});

describe("findViolations detects hand-made corruption", () => {
  test("flags a size pair that does not sum to 1", () => {
    let counter = 0;
    const makeId = () => `n${++counter}`;
    const tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
    const split = tree.nodes.n2;
    if (!split || !isSplit(split)) throw new Error("fixture is wrong");

    const broken: LayoutTree = {
      ...tree,
      nodes: { ...tree.nodes, n2: { ...split, sizes: [0.5, 0.2] } },
    };
    expect(findViolations(broken)).toEqual([
      expect.stringContaining("sizes sum to"),
    ]);
  });

  test("flags an orphaned node", () => {
    let counter = 0;
    const makeId = () => `n${++counter}`;
    const tree = createTree(makeId, 1);
    const orphan = { ...tree.nodes.n1!, id: "ghost" };
    const broken: LayoutTree = {
      ...tree,
      nodes: { ...tree.nodes, ghost: orphan },
    };
    expect(findViolations(broken)).toEqual([
      expect.stringContaining('node "ghost" is orphaned'),
    ]);
  });

  test("flags a parentId that disagrees with the tree", () => {
    let counter = 0;
    const makeId = () => `n${++counter}`;
    const tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
    const broken: LayoutTree = {
      ...tree,
      nodes: { ...tree.nodes, n1: { ...tree.nodes.n1!, parentId: "ghost" } },
    };
    expect(findViolations(broken)).toEqual([
      expect.stringContaining('has parentId "ghost"'),
    ]);
  });

  test("flags a missing root", () => {
    expect(findViolations({ rootId: "gone", nodes: {}, dock: [] })).toEqual([
      'root "gone" is missing from nodes',
    ]);
  });
});
