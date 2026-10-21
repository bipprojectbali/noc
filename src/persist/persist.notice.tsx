import { useWallStore } from "../pane/pane.store.ts";

/**
 * Says so when the wall is not saving. Rendered above the wall rather than over
 * it, so the message never covers the page a pane is showing.
 */
export function PersistenceNotice() {
  const status = useWallStore((state) => state.persistence);
  if (status.kind === "ready") return null;

  const message =
    status.kind === "loading" ? "Loading the saved layout…" : status.message;
  const tone = status.kind === "unavailable" ? "noc-notice--error" : "";

  return (
    <p className={`noc-notice ${tone}`.trim()} role="status" data-testid="persistence-notice">
      {message}
    </p>
  );
}
