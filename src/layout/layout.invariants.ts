/** Structural checks for the pane tree, used by tests and by deserialization. */

import { MIN_FRACTION } from "./layout.tree.ts";
import {
  isPane,
  isSplit,
  type LayoutTree,
  type NodeId,
} from "./layout.types.ts";

/** Tolerance for fraction sums, which accumulate float error across resizes. */
export const SIZE_EPSILON = 1e-9;

/**
 * Returns one message per violated invariant; an empty array means the tree is
 * well formed. Returning all violations rather than throwing on the first keeps
 * property-test failures readable.
 */
export function findViolations(tree: LayoutTree): string[] {
  const problems: string[] = [];
  const visits = new Map<NodeId, number>();

  const root = tree.nodes[tree.rootId];
  if (root === undefined) {
    return [`root "${tree.rootId}" is missing from nodes`];
  }
  if (root.parentId !== null) {
    problems.push(`root "${tree.rootId}" must have parentId null`);
  }

  const walk = (id: NodeId, expectedParent: NodeId | null, depth: number): void => {
    if (depth > Object.keys(tree.nodes).length + 1) {
      problems.push(`cycle detected at "${id}"`);
      return;
    }
    visits.set(id, (visits.get(id) ?? 0) + 1);
    if ((visits.get(id) ?? 0) > 1) return;

    const node = tree.nodes[id];
    if (node === undefined) {
      problems.push(`node "${id}" is referenced but missing`);
      return;
    }
    if (node.parentId !== expectedParent) {
      problems.push(
        `node "${id}" has parentId "${node.parentId}" but is a child of "${expectedParent}"`,
      );
    }
    if (!isSplit(node)) return;

    const [first, second] = node.children;
    if (first === second) {
      problems.push(`split "${id}" has the same child twice`);
    }
    const sum = node.sizes[0] + node.sizes[1];
    if (Math.abs(sum - 1) > SIZE_EPSILON) {
      problems.push(`split "${id}" sizes sum to ${sum}, expected 1`);
    }
    for (const size of node.sizes) {
      if (size < MIN_FRACTION - SIZE_EPSILON) {
        problems.push(`split "${id}" has size ${size} below MIN_FRACTION`);
      }
    }
    walk(first, id, depth + 1);
    walk(second, id, depth + 1);
  };

  walk(tree.rootId, null, 0);

  for (const [id, count] of visits) {
    if (count > 1) {
      problems.push(`node "${id}" is reachable ${count} times, expected once`);
    }
  }

  const docked = new Set(tree.dock.map((entry) => entry.paneId));
  for (const id of Object.keys(tree.nodes)) {
    if (visits.has(id) || docked.has(id)) continue;
    problems.push(`node "${id}" is orphaned: not in the tree and not docked`);
  }

  for (const entry of tree.dock) {
    const node = tree.nodes[entry.paneId];
    if (node === undefined) {
      problems.push(`docked pane "${entry.paneId}" is missing from nodes`);
      continue;
    }
    if (!isPane(node)) {
      problems.push(`docked node "${entry.paneId}" is a split, not a pane`);
    }
    if (visits.has(entry.paneId)) {
      problems.push(`pane "${entry.paneId}" is both docked and in the tree`);
    }
  }

  const treePaneCount = [...visits.keys()].filter((id) => {
    const node = tree.nodes[id];
    return node !== undefined && isPane(node);
  }).length;
  if (treePaneCount < 1) {
    problems.push("tree must always contain at least one pane");
  }

  return problems;
}

export function assertWellFormed(tree: LayoutTree): void {
  const problems = findViolations(tree);
  if (problems.length > 0) {
    throw new Error(`Malformed layout tree: ${problems.join("; ")}`);
  }
}
