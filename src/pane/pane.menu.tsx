/**
 * All of a pane's chrome behind one thin strip, because chrome cost used to
 * scale with pane count.
 *
 * Two permanent rows per pane — a URL bar above the body and a button row below
 * it — is affordable for one pane and unusable for eight: the URL field
 * collapses to a few characters, the buttons overlap, and one pane's row sits
 * against the next pane's. A wall exists to hold many sites, so its chrome has
 * to shrink as panes multiply rather than multiply with them.
 *
 * The panel the strip opens is an overlay, and an overlay is the one thing this
 * codebase otherwise forbids: a native child webview is an OS-level view that
 * paints above the whole web layer and ignores CSS clipping, so a panel drawn
 * across one would simply not be there. Rather than a fourth `invoke` and a
 * native menu, this reuses the seam that already exists for splitter drags —
 * `suspendPanePointerCapture` hides every webview for as long as it is held.
 * The consequence is deliberate and accepted: while a menu is open, every
 * webview pane on the wall goes blank. Hiding is not destroying, so the pages
 * keep running and come back at the same scroll position when it closes. The
 * suppressor's iframe arm earns its keep here too: it drops `pointer-events` on
 * every frame, so a click meant to dismiss the panel reaches this document
 * instead of disappearing into a cross-origin iframe.
 *
 * Right-click opens the same menu, but only on surfaces this app owns — the
 * strip, and the empty area of an empty pane, which `pane.frame` wires. Over a
 * loaded site there is nothing to hook: a cross-origin iframe never hands its
 * `contextmenu` to the parent, and a native webview takes the event at OS level
 * where the web layer never sees it.
 */

import { useEffect, useRef } from "react";

import type {
  PaneId,
  PaneStrategy,
  SplitDirection,
} from "../layout/layout.types.ts";
import {
  resumePanePointerCapture,
  suspendPanePointerCapture,
} from "../resize/resize.pointer-capture.ts";
import { PaneMenuPanel } from "./pane.menu-panel.tsx";

export type PaneMenuProps = {
  paneId: PaneId;
  url: string | null;
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

/** The host alone: a full URL cannot survive a pane two columns wide. */
function stripLabel(url: string | null): string {
  return url === null ? "Empty" : new URL(url).host;
}

export function PaneMenu({
  paneId,
  url,
  open,
  onOpenChange,
  ...panel
}: PaneMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Held for exactly as long as the panel is open. The cleanup covers every
  // close path there is — the button again, Escape, a click outside, and the
  // pane being deleted with its menu still open — which is why no call site
  // below releases it by hand.
  useEffect(() => {
    if (!open) return;
    suspendPanePointerCapture();
    return () => resumePanePointerCapture();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root !== null && root.contains(event.target as Node)) return;
      onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, onOpenChange]);

  return (
    <div className="noc-pane__menu-root" ref={rootRef}>
      <div
        className="noc-pane__strip"
        data-testid={`pane-strip-${paneId}`}
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenChange(true);
        }}
      >
        <span className="noc-pane__strip-label" title={url ?? "Empty pane"}>
          {stripLabel(url)}
        </span>
        <button
          className="noc-pane__strip-button"
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Menu for pane ${paneId}`}
          title="Pane menu"
          data-testid={`pane-menu-button-${paneId}`}
          onClick={() => onOpenChange(!open)}
        >
          ⋮
        </button>
      </div>

      {open && <PaneMenuPanel paneId={paneId} url={url} {...panel} />}
    </div>
  );
}
