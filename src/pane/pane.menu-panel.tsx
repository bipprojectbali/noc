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

import { useEffect, useState } from "react";

import type { PaneId, PaneStrategy, SplitDirection } from "../layout/layout.types.ts";
import { SessionMenuItem } from "../session/session.menu-item.tsx";
import { PaneMenuRendererField } from "./pane.menu-renderer-field.tsx";

export type PaneMenuPanelProps = {
  paneId: PaneId;
  url: string | null;
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

  // Follow the pane's url when it changes elsewhere, without fighting typing.
  useEffect(() => {
    setDraft(url ?? "");
  }, [url]);

  const actions = [
    { slug: "reload", label: "Reload", run: onReload },
    { slug: "split-row", label: "Split right", run: () => onSplit("row") },
    { slug: "split-column", label: "Split down", run: () => onSplit("column") },
  ];

  return (
    <div className="noc-pane__menu" role="menu" data-testid={`pane-menu-${paneId}`}>
      <form
        className="noc-pane__menu-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(draft);
        }}
      >
        <input
          className="noc-pane__input"
          aria-label={`URL for pane ${paneId}`}
          aria-invalid={error !== null}
          placeholder="URL, then Enter"
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
