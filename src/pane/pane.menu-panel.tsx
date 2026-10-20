/**
 * What ⋮ opens: an ordinary desktop context menu, not a settings page.
 *
 * The first attempt stretched every control to the pane's width, which read as
 * a form bolted to a dashboard. This is the shape people know — a narrow card
 * under the button, single-line rows, groups parted one way and only one way,
 * the destructive item last and in the danger colour. The width is fixed so
 * the panel fits the smallest pane a wall will make, and it is 224px because
 * that is the longest renderer label: an option nobody can finish reading is
 * not an option.
 *
 * Three groups: what the pane shows, what to do to it, and the one that
 * destroys it. Address and renderer sit together because they answer the same
 * question, so they share one geometry. Cookie import sits with the actions
 * even though it is wall-wide rather than per pane: there is no wall-level
 * menu to put it in, and every pane's ⋮ is the same door onto it. The address
 * is first because giving a pane a URL is the one thing this menu exists for;
 * Enter submits it, and a Go button bought nothing a form already does. Each
 * renderer label names its cost, because switching rebuilds the content and
 * the site reloads.
 *
 * Split from `pane.menu` along the line that matters rather than to make two
 * files: that one owns the panel's lifetime, this one owns its contents and
 * holds nothing but the address being typed.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { PaneId, PaneStrategy, SplitDirection } from "../layout/layout.types.ts";
import { SessionMenuItem } from "../session/session.menu-item.tsx";
import { PaneMenuRendererField } from "./pane.menu-renderer-field.tsx";
import { PaneMenuSites } from "./pane.menu-sites.tsx";
import { PaneMenuZoomField, type PaneZoomControl } from "./pane.menu-zoom.tsx";
import type { PaneSitesControl } from "./pane.site-switcher.tsx";

/** Breathing room kept between the panel and the window edge. */
const PANEL_VIEWPORT_MARGIN_PX = 8;

/**
 * How far the panel has to slide to stay inside the window.
 *
 * The panel hangs from the pane's right edge and grows leftwards, which is
 * right until the pane itself is at the wall's left edge: then 224px of menu
 * lands at a negative x, and `html, body { overflow: hidden }` (invariant:
 * no rubber-band) makes that part not merely off-screen but unreachable —
 * measured at `x: -148.6` on an 84px pane at x=0. The same happens downwards
 * for a pane in the bottom row. So the panel is clamped against the *window*;
 * clamping against the pane is what the CSS already does and what fails.
 *
 * Pure, so the arithmetic is provable without a browser, and degenerate rects
 * ask for no shift at all: happy-dom measures every element as nought, and a
 * menu that has not been laid out must not be dragged anywhere.
 */
export function menuPanelShift(
  rect: { left: number; right: number; top: number; bottom: number },
  viewport: { width: number; height: number },
  margin: number = PANEL_VIEWPORT_MARGIN_PX,
): { x: number; y: number } {
  if (rect.right <= rect.left || rect.bottom <= rect.top) return { x: 0, y: 0 };
  return {
    x: axisShift(rect.left, rect.right, viewport.width, margin),
    y: axisShift(rect.top, rect.bottom, viewport.height, margin),
  };
}

/**
 * One axis of the clamp. The margin is where an escaped edge is put back, not a
 * gap the panel is owed: a panel flush against the window edge is inside it,
 * and nudging that one would move menus nobody reported.
 */
function axisShift(near: number, far: number, size: number, margin: number): number {
  if (near < 0) return margin - near;
  if (far > size) return Math.min(0, size - margin - far);
  return 0;
}

export type PaneMenuPanelProps = {
  paneId: PaneId;
  url: string | null;
  sites: PaneSitesControl;
  zoom: PaneZoomControl;
  error: string | null;
  strategy: PaneStrategy;
  nativeHost: boolean;
  onSubmit: (raw: string) => void;
  onReload: () => void;
  onStrategyChange: (strategy: PaneStrategy) => void;
  onSplit: (direction: SplitDirection) => void;
  onClose: () => void;
};

export function PaneMenuPanel({
  paneId,
  url,
  sites,
  zoom,
  error,
  strategy,
  nativeHost,
  onSubmit,
  onReload,
  onStrategyChange,
  onSplit,
  onClose,
}: PaneMenuPanelProps) {
  const [draft, setDraft] = useState(url ?? "");
  /** Whether Enter appends a page instead of repointing the one on screen. */
  const [adding, setAdding] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Slide the panel back inside the window. Imperative and in a layout effect
  // for the same reason pane geometry is (`geometry.sync`): it is a correction
  // to a measurement, so it must land before the frame is shown, and it must
  // not become React state that re-renders the menu on every open. The reset
  // first is load-bearing — measuring a panel that is already shifted would
  // clamp the clamp. Re-run whenever the panel's own height can change, which
  // is the site list and the error line.
  useLayoutEffect(() => {
    const node = panelRef.current;
    if (node === null) return;
    node.style.transform = "";
    const shift = menuPanelShift(node.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    if (shift.x !== 0 || shift.y !== 0) {
      node.style.transform = `translate(${shift.x}px, ${shift.y}px)`;
    }
  }, [adding, error, sites.list.length]);

  // Follow the pane's url when it changes elsewhere, without fighting typing.
  useEffect(() => {
    setDraft(url ?? "");
    setAdding(false);
  }, [url]);

  const actions = [
    { slug: "reload", label: "Reload", run: onReload },
    { slug: "split-row", label: "Split right", run: () => onSplit("row") },
    { slug: "split-column", label: "Split down", run: () => onSplit("column") },
  ];

  return (
    <div
      ref={panelRef}
      className="noc-pane__menu"
      role="menu"
      data-testid={`pane-menu-${paneId}`}
    >
      <form
        className="noc-pane__menu-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (adding) sites.add(draft);
          else onSubmit(draft);
        }}
      >
        <input
          // Remounted when the mode changes so `autoFocus` puts the caret back
          // in the field the user has just been told to type in.
          key={adding ? "add" : "point"}
          className="noc-pane__input"
          autoFocus
          aria-label={
            adding ? `New site URL for pane ${paneId}` : `URL for pane ${paneId}`
          }
          aria-invalid={error !== null}
          placeholder={adding ? "New site URL, then Enter" : "URL, then Enter"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </form>

      {error !== null && (
        <span className="noc-pane__menu-error" role="alert">
          {error}
        </span>
      )}

      <PaneMenuRendererField
        paneId={paneId}
        strategy={strategy}
        nativeHost={nativeHost}
        onStrategyChange={onStrategyChange}
      />

      {/* With the renderer and not with the actions: both answer "how is this
          page shown", and neither closes the menu — zoom is stepped while the
          result is watched, which the action rows below are not. */}
      <PaneMenuZoomField paneId={paneId} zoom={zoom} />

      <PaneMenuSites
        paneId={paneId}
        sites={sites}
        adding={adding}
        onAddMode={() => {
          setAdding(true);
          setDraft("");
        }}
      />

      <div className="noc-pane__menu-rule" />

      {actions.map((item) => (
        <button
          key={item.slug}
          className="noc-pane__menu-item"
          type="button"
          role="menuitem"
          data-testid={`pane-${item.slug}-${paneId}`}
          onClick={item.run}
        >
          {item.label}
        </button>
      ))}

      <SessionMenuItem paneId={paneId} nativeHost={nativeHost} />

      <div className="noc-pane__menu-rule" />

      <button
        className="noc-pane__menu-item noc-pane__menu-item--danger"
        type="button"
        role="menuitem"
        data-testid={`pane-close-${paneId}`}
        onClick={onClose}
      >
        Close
      </button>
    </div>
  );
}
