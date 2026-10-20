/**
 * The agreed shape of the cookie-import store, standing in for the store
 * itself while it is written in parallel.
 *
 * This file exists for one reason and has one expiry: `session.store.ts` is
 * being built at the same time as the menu item that consumes it, so the UI
 * needs the contract without the implementation. At integration the types move
 * into the real store and the registry below is deleted — the menu item then
 * imports `useSessionImport` straight from it and nothing else changes.
 *
 * The registry is here rather than props because the menu item is rendered two
 * levels below `PaneFrame` and `pane.menu` deliberately forwards nothing it
 * does not own; drilling a wall-wide concern through a per-pane component would
 * be the wrong seam even if it were allowed. It follows the same shape as the
 * suppressor registry in `resize.pointer-capture`: module-level, replaced once,
 * never during a render.
 */

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

export type SessionImportStore = {
  state: SessionImportState;
  /** Resolves when the import has settled; the outcome arrives via `state`. */
  importFromText: (text: string) => Promise<void>;
};

export type UseSessionImport = () => SessionImportStore;

// TODO(session): a no-op until `session.store.ts` lands and registers itself —
// the control renders and reports idle, it does not import. Remove with this
// whole registry at integration.
const IDLE: SessionImportStore = {
  state: { kind: "idle" },
  importFromText: async () => {},
};

let currentHook: UseSessionImport = () => IDLE;

/**
 * Points the menu item at a store. Call before anything renders: React needs
 * the hook call order to be stable, so swapping this mid-mount is a bug.
 */
export function setSessionImportHook(hook: UseSessionImport | null): void {
  currentHook = hook ?? (() => IDLE);
}

export function useSessionImport(): SessionImportStore {
  return currentHook();
}
