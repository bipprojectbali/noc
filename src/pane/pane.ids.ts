/**
 * Where a pane's identity and its place in the pane layer come from.
 *
 * Split out of `pane.store` because neither of these is state: they are the one
 * rule the flat pane layer rests on, and the store is at its line budget. Every
 * tree action in the store is handed these two and nothing else.
 */

export function makeId(): string {
  return crypto.randomUUID();
}

let lastCreatedAt = 0;

/**
 * Wall-clock time, forced to strictly increase.
 *
 * `createdAt` is the pane layer's entire ordering key, and `Date.now()` only
 * resolves to the millisecond. Two panes created inside one millisecond tie, and
 * `pane.layer` then breaks the tie on the random id — so the newer pane sorts
 * first about half the time, which moves a host that is already mounted. Moving
 * a host re-inserts its iframe, and a re-inserted iframe reloads the page inside
 * it: exactly what the two-layer design exists to prevent. A pane created later
 * must therefore always carry a larger number than every pane before it.
 */
export function nextCreatedAt(): number {
  lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1);
  return lastCreatedAt;
}
