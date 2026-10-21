/**
 * Which monitor the wall fills, for the installed app that replaced the desktop
 * window.
 *
 * A desktop shell could be told to open on a given display. A browser tab
 * cannot, and plain `requestFullscreen()` fills whichever screen the window
 * already sits on — which for a wall that lives on the operator's second
 * monitor means dragging the window there first, every time. The Window
 * Management API is the only way to name a screen from the page, so this module
 * is what the fullscreen control reads.
 *
 * Split from the component because none of the interesting part is React. The
 * naming is the interesting part: `label` is routinely the empty string even
 * when permission is granted, and two identical monitors report byte-identical
 * labels, so a list built straight from the API is a list of blanks or of
 * indistinguishable twins. `describeScreens` is pure and gets the test; the two
 * functions below it are thin wrappers over globals that only a real browser
 * with a real second monitor can exercise.
 *
 * Nothing here is ever required. Every call degrades to "no choice offered",
 * and the control then uses plain `requestFullscreen()`, which works
 * everywhere — the API is Chromium-only and the permission is refusable.
 */

/** A screen as the wall offers it: named, identified, and ready to be asked for. */
export interface WallScreen {
  /** The list position. The API exposes no stable id, so there is none to use. */
  readonly id: string;
  readonly name: string;
  readonly primary: boolean;
  readonly current: boolean;
  /**
   * The platform object `requestFullscreen({ screen })` wants, carried through
   * untouched and deliberately opaque: nothing here reads it, and typing it
   * would mean restating an incubating spec this file does not depend on.
   */
  readonly handle: unknown;
}

/** Only the members read here, so a test can pass plain objects. */
interface ScreenLike {
  readonly label?: string;
}

interface ScreenDetailsLike {
  readonly screens: readonly ScreenLike[];
  /** Spec guarantees this is one of `screens`, which is why identity works. */
  readonly currentScreen: ScreenLike;
}

function baseName(screen: ScreenLike, index: number): string {
  const label = (screen.label ?? "").trim();
  // An unnamed screen is the common case, not the edge one: Chromium returns ""
  // on platforms that give it nothing, and a menu of empty rows is unusable.
  return label === "" ? `Screen ${index + 1}` : label;
}

/**
 * The API's own ordering is kept — it is the platform's arrangement, and
 * resorting it would stop the list matching how the monitors are described
 * anywhere else on the machine.
 */
export function describeScreens(details: ScreenDetailsLike): readonly WallScreen[] {
  const names = details.screens.map(baseName);

  return details.screens.map((screen, index) => {
    const base = baseName(screen, index);
    // Two identical monitors report the same label. Numbering only the
    // collisions keeps the single-monitor and mixed cases clean.
    const shared = names.filter((name) => name === base).length > 1;

    return {
      id: String(index),
      name: shared ? `${base} (${index + 1})` : base,
      primary: isPrimary(screen),
      current: screen === details.currentScreen,
      handle: screen,
    };
  });
}

function isPrimary(screen: ScreenLike): boolean {
  return (screen as { isPrimary?: unknown }).isPrimary === true;
}

/**
 * Whether screens can be listed, asked without triggering the permission
 * prompt — which is the whole point of asking. Enumerating on page load would
 * put a permission dialog in front of a wall nobody asked to move, so the
 * control only enumerates when this already says `granted`, and otherwise waits
 * for a click that means it.
 */
export type ScreenAccess = "granted" | "prompt" | "unavailable";

export async function screenAccess(): Promise<ScreenAccess> {
  if (!("getScreenDetails" in globalThis)) return "unavailable";
  try {
    const status = await navigator.permissions.query({
      // Not in `PermissionName`: the API is still in incubation.
      name: "window-management" as PermissionName,
    });
    if (status.state === "denied") return "unavailable";
    return status.state === "granted" ? "granted" : "prompt";
  } catch {
    // An unknown permission name throws. A browser that has `getScreenDetails`
    // but spells its permission differently is still worth asking, and asking
    // is a prompt — so say so rather than hiding the control.
    return "prompt";
  }
}

export type ScreensResult =
  | { readonly ok: true; readonly screens: readonly WallScreen[] }
  | { readonly ok: false; readonly reason: "unavailable" | "denied" };

/**
 * Prompts, if permission has not been decided. Call it from a click, never from
 * an effect on mount.
 */
export async function readScreens(): Promise<ScreensResult> {
  const getScreenDetails = (globalThis as { getScreenDetails?: unknown })
    .getScreenDetails;
  if (typeof getScreenDetails !== "function") return { ok: false, reason: "unavailable" };

  try {
    const details = (await getScreenDetails.call(globalThis)) as ScreenDetailsLike;
    return { ok: true, screens: describeScreens(details) };
  } catch {
    // The one failure worth distinguishing: the user said no, and the control
    // should stop offering rather than keep prompting.
    return { ok: false, reason: "denied" };
  }
}

export type FullscreenResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * `screen` omitted — or present on a browser without the API, which ignores the
 * unknown dictionary member — fills the screen the window is already on. That
 * is the fallback, and it needs no branch here.
 */
export async function fillScreen(
  element: Element,
  screen: WallScreen | null,
): Promise<FullscreenResult> {
  try {
    await element.requestFullscreen(
      screen === null ? undefined : ({ screen: screen.handle } as FullscreenOptions),
    );
    return { ok: true };
  } catch (error) {
    // Never silent: a refused request leaves the wall exactly as it was, and a
    // control that does nothing without saying so reads as broken.
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
