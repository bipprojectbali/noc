/**
 * The layout layer: renders the tree as nested boxes whose leaves are empty
 * slots. It holds no pane content, so React may rebuild any of it at will.
 */

import { SLOT_ATTRIBUTE } from "../geometry/geometry.sync.ts";
import { isPane, type LayoutTree, type NodeId } from "./layout.types.ts";

export type LayoutRendererProps = { tree: LayoutTree };

function LayoutNodeView({ tree, nodeId }: { tree: LayoutTree; nodeId: NodeId }) {
  const node = tree.nodes[nodeId];
  if (node === undefined) return null;

  if (isPane(node)) {
    // Empty on purpose: the pane itself lives in the pane layer, and is placed
    // over this slot by measuring it. Putting content here would tie the pane's
    // DOM node to the tree's shape.
    return (
      <div
        className="noc-slot"
        data-testid={`slot-${node.id}`}
        {...{ [SLOT_ATTRIBUTE]: node.id }}
      />
    );
  }

  const [firstId, secondId] = node.children;
  const [firstSize, secondSize] = node.sizes;
  return (
    <div
      className={`noc-split noc-split--${node.direction}`}
      data-testid={`split-${node.id}`}
    >
      <div className="noc-split__child" style={{ flexGrow: firstSize }}>
        <LayoutNodeView tree={tree} nodeId={firstId} />
      </div>
      <div className="noc-split__child" style={{ flexGrow: secondSize }}>
        <LayoutNodeView tree={tree} nodeId={secondId} />
      </div>
    </div>
  );
}

export function LayoutRenderer({ tree }: LayoutRendererProps) {
  return <LayoutNodeView tree={tree} nodeId={tree.rootId} />;
}
