import { describe, expect, test } from "bun:test";

import {
  CURRENT_LAYOUT_VERSION,
  parseLayout,
  serializeLayout,
} from "../../src/layout/layout.serializer.ts";
import {
  createTree,
  setPaneUrl,
  splitPane,
} from "../../src/layout/layout.tree.ts";
import { dockPane } from "../../src/layout/layout.remove.ts";

function sampleTree() {
  let counter = 0;
  const makeId = () => `n${++counter}`;
  let tree = splitPane(createTree(makeId, 1), "n1", "row", makeId, 2);
  tree = splitPane(tree, "n3", "column", makeId, 3);
  tree = setPaneUrl(tree, "n1", "https://example.com/");
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
    const payload = { version: CURRENT_LAYOUT_VERSION - 1, tree: sampleTree() };
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
