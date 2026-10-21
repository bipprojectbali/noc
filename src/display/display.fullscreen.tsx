/**
 * The control that fills a monitor with the wall.
 *
 * Why it exists at all: the installed app is what replaced the desktop window,
 * and an installed PWA still opens in a window with a title bar. Operators run
 * this on a wall-mounted screen, so there has to be something in the page that
 * takes it fullscreen — and on the right screen, which is the half plain
 * fullscreen cannot do (`display.screens.ts`).
 *
 * **Why it looks like this rather than a toolbar.** A reserved strip is the one
 * shape this project has already paid for and removed: the pane chrome used to
 * reserve 20px above every webview, and the reserved space — not its colour —
 * is what made the wall read as stitched-together boxes. So this follows the
 * two wall-level precedents instead. Like `PersistenceNotice` it is a direct
 * child of `.noc-root`, and like the pane `⋮` it floats: absolutely positioned,
 * zero reserved height, nothing moves when it appears.
 *
 * Bottom-left, which is the only free corner. Every pane's own chrome sits top
 * right, so the wall's top-right belongs to whichever pane is up there.
 *
 * **Why there is no open/close panel.** The pane menu needs one because it has
 * a dozen controls; this has one, until a second monitor exists. A single
 * monitor — the common case — shows exactly one button, and the screen rows
 * appear above it only when there is something to choose between. That is
 * cheaper than a panel by a focus trap, an outside-click listener and an
 * Escape handler, and it cannot be left open over the wall.
 *
 * It fullscreens `documentElement`, not `.noc-root`: the wall *is* the page, and
 * the control has to stay inside the fullscreen element or there is no way back
 * out once the browser's own UI is gone.
 */

import { useCallback, useEffect, useState } from "react";

import {
  fillScreen,
  readScreens,
  screenAccess,
  type ScreenAccess,
  type WallScreen,
} from "./display.screens.ts";

/**
 * Truthiness, not `!== null`: the property is specified as `Element | null`,
 * but anything short of a full implementation leaves it `undefined` — which a
 * null check reads as "already fullscreen", turning the button into one that
 * only ever offers to leave.
 */
function isFullscreen(): boolean {
  return Boolean(document.fullscreenElement);
}

export function WallFullscreen() {
  const [fullscreen, setFullscreen] = useState(false);
  const [screens, setScreens] = useState<readonly WallScreen[]>([]);
  const [access, setAccess] = useState<ScreenAccess>("unavailable");
  const [problem, setProblem] = useState<string | null>(null);

  // The browser is the source of truth, not this component: Escape and F11
  // leave fullscreen without going through the button.
  useEffect(() => {
    const read = () => setFullscreen(isFullscreen());
    read();
    document.addEventListener("fullscreenchange", read);
    return () => document.removeEventListener("fullscreenchange", read);
  }, []);

  // Only the permission *state* on mount. Enumerating here would put a
  // permission dialog in front of a wall nobody asked to move.
  useEffect(() => {
    let live = true;
    void (async () => {
      const state = await screenAccess();
      if (!live) return;
      setAccess(state);
      if (state !== "granted") return;
      const result = await readScreens();
      if (live && result.ok) setScreens(result.screens);
    })();
    return () => {
      live = false;
    };
  }, []);

  /** Re-read after moving, so `current` follows the wall. */
  const refresh = useCallback(async () => {
    const result = await readScreens();
    if (result.ok) setScreens(result.screens);
    else if (result.reason === "denied") setScreens([]);
    return result;
  }, []);

  const toggle = useCallback(async () => {
    setProblem(null);
    if (isFullscreen()) {
      await document.exitFullscreen();
      return;
    }
    // No await before this one: an awaited permission prompt would consume the
    // user activation that `requestFullscreen` needs, and the first click would
    // quietly do nothing.
    const result = await fillScreen(document.documentElement, null);
    if (!result.ok) setProblem(result.reason);
  }, []);

  const moveTo = useCallback(async (screen: WallScreen) => {
    setProblem(null);
    const result = await fillScreen(document.documentElement, screen);
    if (result.ok) void refresh();
    else setProblem(result.reason);
  }, [refresh]);

  /** The click that means "yes, prompt me" — see the mount effect. */
  const findScreens = useCallback(async () => {
    setProblem(null);
    const result = await refresh();
    if (result.ok) setAccess("granted");
    else {
      setAccess("unavailable");
      setProblem(
        result.reason === "denied"
          ? "Screen access was refused, so the wall can only fill this screen."
          : "This browser cannot name screens, so the wall can only fill this one.",
      );
    }
  }, [refresh]);

  return (
    <div className="noc-fullscreen" data-testid="wall-fullscreen">
      {problem !== null && (
        <p className="noc-fullscreen__problem" role="status" data-testid="wall-fullscreen-problem">
          {problem}
        </p>
      )}

      {screens.length > 1 &&
        screens.map((screen) => (
          <button
            key={screen.id}
            type="button"
            className="noc-fullscreen__screen"
            aria-pressed={screen.current}
            title={screen.primary ? `${screen.name} — primary` : screen.name}
            data-testid={`wall-fullscreen-screen-${screen.id}`}
            onClick={() => void moveTo(screen)}
          >
            {screen.name}
          </button>
        ))}

      {access === "prompt" && (
        <button
          type="button"
          className="noc-fullscreen__screen"
          data-testid="wall-fullscreen-find"
          onClick={() => void findScreens()}
        >
          Choose a screen…
        </button>
      )}

      <button
        type="button"
        className="noc-fullscreen__toggle"
        aria-pressed={fullscreen}
        aria-label={fullscreen ? "Leave fullscreen" : "Fill the screen"}
        title={fullscreen ? "Leave fullscreen" : "Fill the screen"}
        data-testid="wall-fullscreen-toggle"
        onClick={() => void toggle()}
      >
        ⛶
      </button>
    </div>
  );
}
