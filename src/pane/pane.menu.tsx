/**
 * A pane's whole chrome: one ⋮ button and the menu it opens. No header row, no
 * host label, nothing permanently reserved above the body — a wall put on
 * monitors is looked at, not administered, and a strip per pane made the grid
 * read as stitched together.
 *
 * The button floats over the pane's top-right corner, nearly invisible until
 * the pane is hovered, the button takes focus, or the menu is open. Its own
 * dark backdrop and light ring keep it legible over a white dashboard and a
 * dark one alike. Its container is wider than the button, so the container
 * takes no pointer at all and the page loses the button's 24px square and
 * nothing more — a dashboard keeps its own controls in that very corner.
 *
 * The panel is an overlay, the one thing this codebase otherwise forbids. Its
 * licence is `suspendPanePointerCapture`: while it is open every pane stops
 * taking the pointer, the same seam splitter drags already use — which is also
 * how a click meant to dismiss the panel reaches this document rather than a
 * cross-origin frame.
 *
 * ⋮ carries a second gesture for the same reason it carries the first: it is
 * the only surface this app owns on a loaded pane. A press that moves past a
 * few pixels drags the pane somewhere else on the wall instead of opening
 * anything — `pane.drag` owns that, including the click it then has to swallow.
 *
 * Right-click opens the same menu on surfaces this app owns: an empty pane's
 * message (`pane.frame` wires it) and the button alone, since the box around it
 * is transparent to the pointer. The handler stays on the container because the
 * button's events bubble to it anyway. Over a loaded site there is nothing to
 * hook — a cross-origin iframe never hands its `contextmenu` to the parent — so
 * a loaded pane is reached through ⋮ and nothing else.
 */

import { useEffect, useRef } from "react";

import type { PaneId, SplitDirection } from "../layout/layout.types.ts";
import {
  resumePanePointerCapture,
  suspendPanePointerCapture,
} from "../resize/resize.pointer-capture.ts";
import { usePaneDragHandle } from "./pane.drag.ts";
import { usePaneMenuDismiss } from "./pane.menu-dismiss.ts";
import { PaneMenuPanel } from "./pane.menu-panel.tsx";
import type { PaneZoomControl } from "./pane.menu-zoom.tsx";
import {
  PaneSiteSwitcher,
  type PaneSitesControl,
} from "./pane.site-switcher.tsx";

export type PaneMenuProps = {
  paneId: PaneId;
  url: string | null;
  /**
   * The pages this pane holds. The switcher that shows them is a sibling of ⋮
   * inside this one chrome box, so it floats with it. Not a luxury: the pips are
   * the only control a multi-page pane has that does not open the menu to use.
   */
  sites: PaneSitesControl;
  /**
   * Magnification of the page on screen. Passes straight through to the panel:
   * the floating row has no space for it, and nothing about it is worth a
   * control that is visible without opening the menu.
   */
  zoom: PaneZoomControl;
  error: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (raw: string) => void;
  onReload: () => void;
  onSplit: (direction: SplitDirection) => void;
  onClose: () => void;
};

export function PaneMenu({
  paneId,
  url,
  sites,
  open,
  onOpenChange,
  ...panel
}: PaneMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  // ⋮ is also the wall's drag handle: see `pane.drag` for why it has to be.
  const dragHandle = usePaneDragHandle(paneId, () => onOpenChange(!open));

  // A dropdown, not a popover: focus follows the menu in and comes back out
  // again. In goes to the address field rather than the first item, because
  // that is what the menu is opened for; out is skipped when the button has
  // gone with its pane, which `Close` does while the menu is still up.
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector("input")?.focus();
    return () => buttonRef.current?.focus();
  }, [open]);

  // Held for exactly as long as the panel is open. The cleanup covers every
  // close path there is — the button again, Escape, a click outside, and the
  // pane being deleted with its menu still open — which is why no call site
  // below releases it by hand.
  useEffect(() => {
    if (!open) return;
    suspendPanePointerCapture();
    return () => resumePanePointerCapture();
  }, [open]);

  usePaneMenuDismiss(open, rootRef, onOpenChange);

  return (
    <div
      className="noc-pane__chrome"
      ref={rootRef}
      data-testid={`pane-chrome-${paneId}`}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenChange(true);
      }}
    >
      {/* Before ⋮ in DOM order, so tab order and the row read left to right:
          which page is showing, then what can be done to the pane. */}
      <PaneSiteSwitcher paneId={paneId} sites={sites} />

      <button
        className="noc-pane__menu-button"
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menu for pane ${paneId}`}
        title={url ?? "Pane menu"}
        data-testid={`pane-menu-button-${paneId}`}
        {...dragHandle}
      >
        ⋮
      </button>

      {open && (
        <PaneMenuPanel paneId={paneId} url={url} sites={sites} {...panel} />
      )}
    </div>
  );
}
