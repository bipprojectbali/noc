/**
 * Where the wall stands with storage: still loading, usable, or not usable.
 *
 * The store only holds this value. Nothing here touches the network, so the
 * store can read it without knowing how the layout is saved.
 */

export type PersistenceStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  /** The stored layout could not be read. Writing now would replace it. */
  | { kind: "unavailable"; message: string }
  /** A save failed. Later changes are still attempted. */
  | { kind: "save-failed"; message: string };

/**
 * True when a change may be written. Writing while the stored layout is unknown
 * would overwrite it with whatever the user sees on an empty wall.
 */
export function mayWrite(status: PersistenceStatus): boolean {
  return status.kind === "ready" || status.kind === "save-failed";
}
