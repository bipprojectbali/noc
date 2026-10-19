/**
 * Rate-limited, last-value-wins writer.
 *
 * Dragging a splitter rewrites the split's fractions dozens of times a second.
 * Each of those is a complete description of the wall, so all but the last are
 * worthless: the writer keeps only the newest value, writes at most once per
 * `minIntervalMs`, and always writes once more after the last push so the state
 * the user stopped on is the state that lands.
 */

export type WriterTimer = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type CoalescingWriterOptions<T> = {
  minIntervalMs: number;
  write: (value: T) => Promise<void> | void;
  /** Writes happen off the caller's stack, so failures need somewhere to go. */
  onError: (error: unknown) => void;
  now?: () => number;
  timer?: WriterTimer;
};

export type CoalescingWriter<T> = {
  push: (value: T) => void;
  /** Resolves once the newest pushed value has reached `write`. */
  flush: () => Promise<void>;
  /** Drops anything still pending. For teardown, not for normal use. */
  cancel: () => void;
};

/** Upper bound on flush rounds, so a pathological push loop fails loudly. */
const MAX_FLUSH_ROUNDS = 8;

const defaultTimer: WriterTimer = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createCoalescingWriter<T>(
  options: CoalescingWriterOptions<T>,
): CoalescingWriter<T> {
  const now = options.now ?? Date.now;
  const timer = options.timer ?? defaultTimer;

  let pending: { value: T } | null = null;
  let handle: unknown = null;
  let lastWriteStartedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;

  const runPending = async (): Promise<void> => {
    handle = null;
    if (pending === null) return;
    const { value } = pending;
    pending = null;
    lastWriteStartedAt = now();
    try {
      await options.write(value);
    } catch (error) {
      options.onError(error);
    }
  };

  const drain = (): void => {
    inFlight = runPending().finally(() => {
      inFlight = null;
      // A push that arrived mid-write is still pending, so keep the chain going
      // rather than waiting for the next push to notice.
      if (pending !== null) schedule();
    });
  };

  const schedule = (): void => {
    if (handle !== null || inFlight !== null) return;
    const waited = now() - lastWriteStartedAt;
    const delay = Math.max(0, options.minIntervalMs - waited);
    handle = timer.setTimeout(drain, delay);
  };

  return {
    push(value) {
      pending = { value };
      schedule();
    },

    async flush() {
      for (let round = 0; round < MAX_FLUSH_ROUNDS; round += 1) {
        // Flush bypasses the rate limit: it exists for the moment the drag
        // ended, when waiting out the interval would be the wrong answer.
        if (handle !== null) {
          timer.clearTimeout(handle);
          handle = null;
        }
        const running = inFlight;
        if (running !== null) {
          await running;
          continue;
        }
        if (pending === null) return;
        drain();
        const started = inFlight;
        if (started !== null) await started;
      }
      throw new Error(
        "Persist writer never settled: each write queued another one. " +
          "Something is pushing snapshots faster than they can be stored.",
      );
    },

    cancel() {
      if (handle !== null) {
        timer.clearTimeout(handle);
        handle = null;
      }
      pending = null;
    },
  };
}
