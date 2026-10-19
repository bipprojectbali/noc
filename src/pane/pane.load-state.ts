/**
 * Pure state machine for what one pane is currently showing.
 *
 * Refusal is decided by the server-side header probe, not by watching the
 * frame: a frame blocked by `X-Frame-Options` still fires `load` in Chromium
 * and its document cannot be read, so the client has nothing to observe.
 */

import type { EmbedVerdict } from "../embed/embed.classifier.ts";

export type PaneLoadState =
  | { kind: "empty" }
  | { kind: "probing"; url: string }
  | { kind: "loading"; url: string }
  | { kind: "ready"; url: string }
  | { kind: "refused"; url: string; reason: string };

export type PaneLoadEvent =
  | { type: "url-set"; url: string }
  | { type: "url-cleared" }
  | { type: "probe-settled"; url: string; verdict: EmbedVerdict; reason: string }
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
      return { kind: "loading", url: event.url };
    }

    case "probe-failed": {
      if (event.url !== currentUrl(state)) return state;
      if (state.kind !== "probing") return state;
      return { kind: "loading", url: event.url };
    }

    case "frame-loaded": {
      if (event.url !== currentUrl(state)) return state;
      return state.kind === "loading" ? { kind: "ready", url: event.url } : state;
    }
  }
}
