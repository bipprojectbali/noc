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
 * This box floats in both renderers, and over an iframe that is the whole
 * story. Over a native child webview it is invisible — an OS-level view paints
 * above the whole web layer and ignores CSS clipping — and what makes it work
 * anyway is that the pane wears a second one: the shell parks an 88x40 chrome
 * webview in the same corner carrying this same row, a click there arrives as a
 * `BroadcastChannel` message (`pane.chrome-channel`), and opening the menu hides
 * every webview, so this box takes over in the same place. The 20px row a
 * webview pane used to reserve for a sibling copy is gone with it, which is why
 * a wall of webview panes no longer reads as stitched together. Nothing here
 * branches on the renderer any more; the stand-in is the shell's business.
 *
 * The panel is an overlay in both cases, the one thing this codebase otherwise
 * forbids. Its licence is `suspendPanePointerCapture`: while it is open every
 * webview is hidden and every iframe stops taking the pointer, the same seam
 * splitter drags already use — which is also how a click meant to dismiss the
 * panel reaches this document rather than a cross-origin frame. Open one menu
 * and every webview pane goes blank: deliberate, and hiding is not destroying,
 * so those pages keep running and come back at the same scroll position.
 *
 * ⋮ carries a second gesture for the same reason it carries the first: it is
 * the only surface this app owns on a loaded pane under either renderer. A
 * press that moves past a few pixels drags the pane somewhere else on the wall
 * instead of opening anything — `pane.drag` owns that, including the click it
 * then has to swallow.
 *
 * Right-click opens the same menu on surfaces this app owns: an empty pane's
 * message (`pane.frame` wires it) and the button alone, since the box around it
 * is transparent to the pointer. The handler stays on the container because the
 * button's events bubble to it anyway. Over a loaded site there is nothing to
 * hook — a cross-origin iframe never hands its `contextmenu` to the parent, a
 * native webview takes the event at OS level — so a loaded pane is reached
 * through ⋮ and nothing else. The chrome page answers right-click itself and
 * sends the same request, so a native pane behaves the same way.
 */

import { useEffect, useRef } from "react";

import type { PaneId, PaneStrategy, SplitDirection } from "../layout/layout.types.ts";
import {
  resumePanePointerCapture,
  suspendPanePointerCapture,
} from "../resize/resize.pointer-capture.ts";
import { usePaneDragHandle } from "./pane.drag.ts";
import { usePaneMenuDismiss } from "./pane.menu-dismiss.ts";
import { PaneMenuPanel } from "./pane.menu-panel.tsx";
import {
  PaneSiteSwitcher,
  type PaneSitesControl,
} from "./pane.site-switcher.tsx";

export type PaneMenuProps = {
  paneId: PaneId;
  url: string | null;
  /**
   * The pages this pane holds. The switcher that shows them is a sibling of ⋮
   * inside this one chrome box, so it floats with it — and on a native pane the
   * shell's chrome webview draws the same pips, from the list `pane.frame` sends
   * it. Not a luxury: the pips are the only control a multi-page pane has that
   * does not blank every webview on the wall to use.
   */
  sites: PaneSitesControl;
  error: string | null;
  strategy: PaneStrategy;
  /**
   * Whether a native webview can exist at all. False in a plain browser, where
   * the option is offered disabled rather than hidden: the limit is the host,
   * not the pane, and a missing control reads as a missing feature.
   */
  nativeHost: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (raw: string) => void;
  onReload: () => void;
  onStrategyChange: (strategy: PaneStrategy) => void;
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
