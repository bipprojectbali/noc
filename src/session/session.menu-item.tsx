/**
 * The ⋮ menu's way in for a cookie export, and the only place that reports how
 * one went.
 *
 * A file picker rather than a paste box: the file comes out of a browser
 * extension already, and asking someone to open `cookies.txt` in an editor to
 * copy a few hundred lines of session tokens is worse in every way. The input
 * is hidden and clicked by the row above it because a bare `<input type=file>`
 * cannot be made to look like a menu row — no plugin, no dependency, no second
 * dialog system; the one the page already has is enough.
 *
 * Outside the shell the row is disabled, not hidden, for the same reason the
 * renderer picker keeps its webview option: there is no shared WebKit store in
 * a browser tab, and a control that vanishes reads as a feature that does not
 * exist rather than one this host cannot offer.
 *
 * The outcome is prose, in the panel, until the next import replaces it. A
 * count is the whole point — "imported" with no number cannot be told apart
 * from an import that silently dropped every row — and the domains WebKit
 * refused are named because those are the sites the user still has to sign
 * into by hand.
 */

import { useRef } from "react";

import type { PaneId } from "../layout/layout.types.ts";
import { useSessionStore, type SessionImportState } from "./session.store.ts";

export type SessionMenuItemProps = {
  paneId: PaneId;
  /** False in a plain browser, where there is no cookie store to plant into. */
  nativeHost: boolean;
};

/** Machine codes from the parser and the bridge, in words a user can act on. */
function reasonText(reason: string): string {
  switch (reason) {
    case "not-native-host":
      return "Cookie import only works in the desktop app.";
    case "empty-file":
      return "That file is empty.";
    case "unrecognised-format":
      return "That is neither a cookies.txt export nor a JSON cookie array.";
    case "no-valid-cookies":
      return "No usable cookies in that file — every row was malformed.";
    default:
      return reason;
  }
}

function doneText(state: Extract<SessionImportState, { kind: "done" }>): string {
  const noun = state.stored === 1 ? "cookie" : "cookies";
  const skipped = state.skipped > 0 ? `, ${state.skipped} skipped` : "";
  const failed =
    state.failedDomains.length > 0
      ? ` Not stored for ${state.failedDomains.join(", ")} — sign in there by hand.`
      : "";
  return `${state.stored} ${noun} imported${skipped}.${failed}`;
}

export function SessionMenuItem({ paneId, nativeHost }: SessionMenuItemProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Read straight from the wall-global store rather than through props: this
  // row is rendered two levels below `PaneFrame`, and drilling a wall-wide
  // concern through per-pane components would make it look pane-scoped. Two
  // selectors, not one object, so the row re-renders only when the import
  // state really changes.
  const state = useSessionStore((store) => store.importState);
  const importFromText = useSessionStore((store) => store.importFromText);

  const pick = async (input: HTMLInputElement): Promise<void> => {
    const file = input.files?.[0];
    // Cleared so picking the same file twice still fires a change event, which
    // is exactly what someone does after re-exporting from the browser.
    input.value = "";
    if (file === undefined) return;
    await importFromText(await file.text());
  };

  const failed = state.kind === "error";
  const message = !nativeHost
    ? "Desktop app only — a browser page cannot write another site's cookies."
    : state.kind === "importing"
      ? "Importing cookies…"
      : state.kind === "done"
        ? doneText(state)
        : failed
          ? reasonText(state.reason)
          : null;

  return (
    <>
      <button
        className="noc-pane__menu-item"
        type="button"
        role="menuitem"
        disabled={!nativeHost || state.kind === "importing"}
        title={
          nativeHost
            ? "Import a cookies.txt or JSON export — applies to the whole wall"
            : "Available only in the desktop app"
        }
        data-testid={`pane-import-cookies-${paneId}`}
        onClick={() => fileRef.current?.click()}
      >
        Import cookies…
      </button>

      <input
        ref={fileRef}
        hidden
        type="file"
        accept=".txt,.json,text/plain,application/json"
        aria-hidden="true"
        tabIndex={-1}
        data-testid={`pane-import-cookies-input-${paneId}`}
        onChange={(event) => {
          void pick(event.currentTarget);
        }}
      />

      {message !== null && (
        <span
          className={failed ? "noc-pane__menu-error" : "noc-pane__menu-note"}
          role={failed ? "alert" : "status"}
          data-testid={`pane-import-cookies-status-${paneId}`}
        >
          {message}
        </span>
      )}
    </>
  );
}
