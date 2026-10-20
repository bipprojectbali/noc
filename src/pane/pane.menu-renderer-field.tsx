/**
 * The renderer row of the ⋮ panel, in its own file for one reason: the panel
 * had reached this repo's 150-line cap for a React component and the next menu
 * item needs the room. Of everything in that panel this is the only block that
 * stands alone — it reads one pane field and writes it back, sharing no state
 * with the address form or the action rows around it.
 *
 * Nothing here is meant to be reusable. It renders the same markup the panel
 * used to render inline, in the same place, and the labels still name what the
 * switch costs: changing renderer rebuilds the content and the site reloads.
 */

import type { PaneId, PaneStrategy } from "../layout/layout.types.ts";

export type PaneMenuRendererFieldProps = {
  paneId: PaneId;
  strategy: PaneStrategy;
  nativeHost: boolean;
  onStrategyChange: (strategy: PaneStrategy) => void;
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

export function PaneMenuRendererField({
  paneId,
  strategy,
  nativeHost,
  onStrategyChange,
}: PaneMenuRendererFieldProps) {
  return (
    <div className="noc-pane__menu-field">
      <span>Renderer</span>
      <select
        className="noc-pane__select"
        aria-label={`Renderer for pane ${paneId}`}
        data-testid={`pane-strategy-${paneId}`}
        value={strategy}
        onChange={(event) => onStrategyChange(event.target.value as PaneStrategy)}
      >
        {STRATEGIES.map((option) => (
          <option key={option} value={option} disabled={option === "webview" && !nativeHost}>
            {strategyLabel(option, nativeHost)}
          </option>
        ))}
      </select>
    </div>
  );
}
