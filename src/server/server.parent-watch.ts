/**
 * Keeps the sidecar from outliving the app that spawned it.
 *
 * Killing the child from the parent only works on an orderly shutdown. A
 * force-quit, a SIGKILL or a crash never runs that code, and that is exactly
 * when an orphaned server is left holding the port. So the child watches the
 * parent instead: ownership of the lifetime sits with the process that can
 * always observe the end.
 */

export type ParentLivenessProbe = (pid: number) => boolean;

export const DEFAULT_PARENT_POLL_MS = 1000;

/**
 * Signal 0 performs the permission and existence checks without delivering
 * anything. `EPERM` means the process is there but owned by someone else, which
 * is still alive; only `ESRCH` means gone.
 *
 * Pid reuse could in principle make a dead parent look alive. The window is one
 * poll interval wide and the worst case is a sidecar that lingers, which is the
 * same failure we already accept for the time between polls.
 */
export const processIsAlive: ParentLivenessProbe = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
};

export type ParentWatchOptions = {
  parentPid: number;
  onOrphaned: (parentPid: number) => void;
  pollMs?: number;
  isAlive?: ParentLivenessProbe;
};

/**
 * Polls the parent and calls `onOrphaned` once it is gone. Returns a stop
 * function; the timer is unref'd so it never keeps the process alive by itself.
 */
export function watchParentProcess(options: ParentWatchOptions): () => void {
  const {
    parentPid,
    onOrphaned,
    pollMs = DEFAULT_PARENT_POLL_MS,
    isAlive = processIsAlive,
  } = options;

  let fired = false;
  const timer = setInterval(() => {
    if (fired || isAlive(parentPid)) return;
    fired = true;
    clearInterval(timer);
    onOrphaned(parentPid);
  }, pollMs);

  timer.unref?.();
  return () => clearInterval(timer);
}
