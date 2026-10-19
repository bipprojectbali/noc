import { useEffect, useState } from "react";

import type { PaneId } from "../layout/layout.types.ts";

export type PaneUrlBarProps = {
  paneId: PaneId;
  url: string | null;
  error: string | null;
  onSubmit: (raw: string) => void;
  onReload: () => void;
  onHide: () => void;
};

export function PaneUrlBar({
  paneId,
  url,
  error,
  onSubmit,
  onReload,
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
