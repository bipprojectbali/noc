/**
 * The one place a cookie import happens, and the only thing that knows an
 * import is finished.
 *
 * It is its own store rather than three more fields on the wall store because
 * an import is not a pane's business: every child webview shares WebKit's
 * `defaultDataStore`, so one import logs the whole wall in at once. Hanging it
 * off a pane would make a wall-wide effect look pane-scoped, and the wall store
 * is already at its line budget.
 *
 * It depends on the wall store, never the reverse. Planting cookies without
 * reloading achieves nothing visible — the pages on screen were fetched with
 * the old (absent) session and will keep showing a login form until they are
 * fetched again — so the reload is part of the import, not a thing the UI is
 * trusted to remember.
 */

import { create } from "zustand";

import { isPane } from "../layout/layout.types.ts";
import {
  nativeCookieBridge,
  type NativeCookieBridge,
} from "../native/native.bridge.ts";
import { useWallStore } from "../pane/pane.store.ts";
import { parseSessionCookies } from "./session.parse.ts";

export type SessionImportState =
  | { kind: "idle" }
  | { kind: "importing" }
  | {
      kind: "done";
      stored: number;
      skipped: number;
      failedDomains: readonly string[];
      at: number;
    }
  | { kind: "error"; reason: string };

export type SessionState = {
  importState: SessionImportState;
  /**
   * Reads an export file's text and plants what it holds. Never rejects: every
   * way this can fail ends in the `error` state, because a thrown promise in a
   * file-input handler is a failure nobody sees.
   *
   * `reason` is a `SessionParseFailure` code when the file could not be read
   * and prose from the shell when the planting failed. Both are for a surface
   * to word, not to print raw.
   */
  importFromText: (text: string) => Promise<void>;
  /** Clears a finished result so the next import starts from nothing. */
  reset: () => void;
};

export type SessionStoreDeps = {
  cookieBridge: NativeCookieBridge;
  /** Called once after a successful import, never after a failure. */
  reloadPanes: () => void;
  now: () => number;
};

/**
 * Reloads every pane that has an address.
 *
 * All of them, not the focused one: the import is wall-wide, and a wall where
 * one pane logged in and the rest did not is the confusing half-state this
 * feature exists to avoid. `reloadPane` already ignores a pane with no url and
 * already routes a webview pane to `reopen`, so both renderers are covered
 * without this knowing which is which.
 */
export function reloadEveryPane(): void {
  const state = useWallStore.getState();
  for (const node of Object.values(state.tree.nodes)) {
    if (isPane(node)) state.reloadPane(node.id);
  }
}

export function createSessionStore(deps: SessionStoreDeps) {
  return create<SessionState>((set) => ({
    importState: { kind: "idle" },

    reset: () => {
      set({ importState: { kind: "idle" } });
    },

    importFromText: async (text) => {
      set({ importState: { kind: "importing" } });

      const parsed = parseSessionCookies(text);
      if (!parsed.ok) {
        // The shell is never asked: there is nothing to hand it, and a round
        // trip that can only answer "received 0" is a worse error message.
        set({ importState: { kind: "error", reason: parsed.reason } });
        return;
      }

      const result = await deps.cookieBridge.importCookies(parsed.cookies);
      if (!result.ok) {
        set({ importState: { kind: "error", reason: result.reason } });
        return;
      }

      // Two different losses, reported as one number: rows the file never
      // yielded a cookie for, and cookies WebKit did not keep. The user cares
      // that some did not arrive, not at which end they were dropped.
      set({
        importState: {
          kind: "done",
          stored: result.report.stored,
          skipped:
            parsed.skipped + (result.report.received - result.report.stored),
          failedDomains: result.report.failedDomains,
          at: deps.now(),
        },
      });
      deps.reloadPanes();
    },
  }));
}

/** The store the running wall uses. Tests build their own. */
export const useSessionStore = createSessionStore({
  cookieBridge: nativeCookieBridge,
  reloadPanes: reloadEveryPane,
  now: Date.now,
});
