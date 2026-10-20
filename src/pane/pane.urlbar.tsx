import { useEffect, useState } from "react";

import type { PaneId, PaneStrategy } from "../layout/layout.types.ts";

export type PaneUrlBarProps = {
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
  onSubmit: (raw: string) => void;
  onReload: () => void;
  onStrategyChange: (strategy: PaneStrategy) => void;
  onHide: () => void;
};

const STRATEGIES: readonly PaneStrategy[] = ["auto", "iframe", "webview"];

/**
 * Plain text, not a tooltip: the cost of each choice has to be readable at the
 * moment it is made. A renderer change rebuilds the pane's content, so the site
 * in it reloads, and the native webview currently sits over the pane's own
 * chrome on macOS — switching to it takes this bar away until that is fixed.
 */
function strategyLabel(strategy: PaneStrategy, nativeHost: boolean): string {
  switch (strategy) {
    case "auto":
      return nativeHost ? "Auto (webview)" : "Auto (iframe)";
    case "iframe":
      return "Iframe (reloads)";
    case "webview":
      return nativeHost
        ? "Webview (reloads; hides this bar on macOS)"
        : "Webview (desktop app only)";
  }
}

export function PaneUrlBar({
  paneId,
  url,
  error,
  strategy,
  nativeHost,
  onSubmit,
  onReload,
  onStrategyChange,
  onHide,
}: PaneUrlBarProps) {
  const [draft, setDraft] = useState(url ?? "");

  // Follow the pane's url when it changes elsewhere, without fighting typing.
  useEffect(() => {
    setDraft(url ?? "");
  }, [url]);

  return (
    <form
      className="noc-pane__chrome"
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
      <button className="noc-pane__button" type="button" onClick={onReload}>
        Reload
      </button>
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
      <button
        className="noc-pane__button"
        type="button"
        onClick={onHide}
        title="Hide this URL bar"
      >
        Hide
      </button>
      {error !== null && <span role="alert">{error}</span>}
    </form>
  );
}
