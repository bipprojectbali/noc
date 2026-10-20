/**
 * Pure state machine for what one pane is currently showing.
 *
 * Refusal is decided by the server-side header probe, not by watching the
 * frame: a frame blocked by `X-Frame-Options` still fires `load` in Chromium
 * and its document cannot be read, so the client has nothing to observe.
 */

import type { EmbedVerdict } from "../embed/embed.classifier.ts";
import type { FrameCookieDecision } from "../embed/embed.cookies.ts";

/**
 * What the same probe said about the target's session cookies.
 *
 * It rides along on the states where the page is actually on screen, because
 * that is when the user tries to log in and when the warning has to be
 * readable. `probing` drops it on purpose: a reload re-asks the question, and
 * yesterday's answer about a cookie is no better evidence than yesterday's
 * answer about a framing header.
 *
 * Absent and `unknown` are the same thing — no answer was given — so the field
 * is left off entirely in that case rather than set to it. A state object
 * carrying `unknown` reads as "the probe had something to say about cookies"
 * when it had nothing.
 */
type WithCookies = { cookies?: FrameCookieDecision | undefined };

export type PaneLoadState =
  | { kind: "empty" }
  | { kind: "probing"; url: string }
  | ({ kind: "loading"; url: string } & WithCookies)
  | ({ kind: "ready"; url: string } & WithCookies)
  | { kind: "refused"; url: string; reason: string };

export type PaneLoadEvent =
  | { type: "url-set"; url: string }
  | { type: "url-cleared" }
  | {
      type: "probe-settled";
      url: string;
      verdict: EmbedVerdict;
      reason: string;
      cookies?: FrameCookieDecision | undefined;
    }
  | { type: "probe-failed"; url: string; reason: string }
  | { type: "frame-loaded"; url: string }
  | { type: "reload" };

export const INITIAL_PANE_LOAD_STATE: PaneLoadState = { kind: "empty" };

function currentUrl(state: PaneLoadState): string | null {
  return state.kind === "empty" ? null : state.url;
}

/**
 * Events carry the url they belong to so a probe that resolves after the user
 * has already typed a different address is discarded instead of applied.
 */
export function reducePaneLoad(
  state: PaneLoadState,
  event: PaneLoadEvent,
): PaneLoadState {
  switch (event.type) {
    case "url-set":
      return { kind: "probing", url: event.url };

    case "url-cleared":
      return { kind: "empty" };

    case "reload": {
      const url = currentUrl(state);
      return url === null ? state : { kind: "probing", url };
    }

    case "probe-settled": {
      if (event.url !== currentUrl(state)) return state;
      if (state.kind !== "probing") return state;
      if (event.verdict === "refused") {
        return { kind: "refused", url: event.url, reason: event.reason };
      }
      // "unknown" is optimistic on purpose: the frame is still worth attempting,
      // and a wrong guess shows an empty frame rather than blocking a valid page.
      const cookies = event.cookies;
      return cookies === undefined || cookies.verdict === "unknown"
        ? { kind: "loading", url: event.url }
        : { kind: "loading", url: event.url, cookies };
    }

    case "probe-failed": {
      if (event.url !== currentUrl(state)) return state;
      if (state.kind !== "probing") return state;
      return { kind: "loading", url: event.url };
    }

    case "frame-loaded": {
      if (event.url !== currentUrl(state)) return state;
      // The cookie verdict came with the probe, one state back, and the page it
      // describes is the one that just loaded. Dropping it here would make the
      // warning flash and vanish the moment the page arrives.
      if (state.kind !== "loading") return state;
      return state.cookies === undefined
        ? { kind: "ready", url: event.url }
        : { kind: "ready", url: event.url, cookies: state.cookies };
    }
  }
}
