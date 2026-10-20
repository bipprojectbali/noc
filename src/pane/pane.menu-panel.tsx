/**
 * What the strip's ⋮ opens: a pane's whole control surface, on demand.
 *
 * Split from `pane.menu` along the line that matters rather than to make two
 * files. That one owns the panel's lifetime — the webview suppressor, Escape, a
 * click outside — and this one owns what is inside it and holds nothing but the
 * address the user is part way through typing. Together they were over the size
 * this project allows a component, and the lifetime half is where the invariants
 * live, so it is the half that has to stay readable.
 *
 * Each renderer label names its cost because the cost is paid the moment the
 * choice is made: switching rebuilds the pane's content, so the site reloads.
 * It no longer warns that a webview covers the pane's own chrome. That was true
 * while `chrome_height()` reported zero on macOS; it now reads AppKit's
 * `contentLayoutRect`, and the chrome a pane still has is a strip above the
 * webview's anchor, never across it.
 */

import { useEffect, useState } from "react";

import type {
  PaneId,
  PaneStrategy,
  SplitDirection,
} from "../layout/layout.types.ts";

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

const STRATEGIES: readonly PaneStrategy[] = ["auto", "iframe", "webview"];

function strategyLabel(strategy: PaneStrategy, nativeHost: boolean): string {
  switch (strategy) {
    case "auto":
      return nativeHost ? "Auto (webview)" : "Auto (iframe)";
    case "iframe":
      return "Iframe (reloads)";
    case "webview":
      return nativeHost ? "Webview (reloads)" : "Webview (desktop app only)";
  }
}

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

  return (
    <div className="noc-pane__menu" role="menu" data-testid={`pane-menu-${paneId}`}>
      <form
        className="noc-pane__menu-row"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(draft);
        }}
      >
        <input
          className="noc-pane__input"
          aria-label={`URL for pane ${paneId}`}
          aria-invalid={error !== null}
          placeholder="dashboard.internal or https://example.com"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="noc-pane__button" type="submit">
          Go
        </button>
      </form>

      {error !== null && (
        <span className="noc-pane__menu-error" role="alert">
          {error}
        </span>
      )}

      <select
        className="noc-pane__button noc-pane__select"
        aria-label={`Renderer for pane ${paneId}`}
        data-testid={`pane-strategy-${paneId}`}
        value={strategy}
        onChange={(event) => {
          onStrategyChange(event.target.value as PaneStrategy);
        }}
      >
        {STRATEGIES.map((option) => (
          <option
            key={option}
            value={option}
            disabled={option === "webview" && !nativeHost}
          >
            {strategyLabel(option, nativeHost)}
          </option>
        ))}
      </select>

      {[
        { slug: "reload", label: "Reload", run: onReload },
        { slug: "split-row", label: "Split right", run: () => onSplit("row") },
        { slug: "split-column", label: "Split down", run: () => onSplit("column") },
        { slug: "close", label: "Close", run: onClose, danger: true },
      ].map((item) => (
        <button
          key={item.slug}
          className={`noc-pane__menu-item${item.danger === true ? " noc-pane__button--danger" : ""}`}
          type="button"
          role="menuitem"
          data-testid={`pane-${item.slug}-${paneId}`}
          onClick={item.run}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
