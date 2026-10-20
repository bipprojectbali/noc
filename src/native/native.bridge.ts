/**
 * The seam between the wall page and the native shell.
 *
 * The wall is served over http, so it runs identically in a browser and inside
 * the Tauri shell. Everything that only exists in the shell is reached through
 * this file, and `isNativeHost` is the one place that asks which one we are in.
 */

import { invoke } from "@tauri-apps/api/core";

import type { PaneId } from "../layout/layout.types.ts";
// The row shape `cookie_import` deserialises is the parser's output type, not a
// second declaration of it: one definition means the two sides cannot drift
// apart silently. `session.types` imports nothing, so this cannot cycle.
import type { SessionCookie } from "../session/session.types.ts";

/**
 * Logical pixels relative to the window's content area, which is the same
 * coordinate space `getBoundingClientRect` reports in.
 */
export type NativeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Mirrors the commands in `src-tauri/src/pane_webview.rs`. */
export type NativePaneBridge = {
  /** Creates the pane's webview, or navigates the existing one. */
  show: (paneId: PaneId, url: string, rect: NativeRect) => Promise<void>;
  /** Moves it and sets whether it is on screen. Hiding never destroys it. */
  place: (paneId: PaneId, rect: NativeRect, visible: boolean) => Promise<void>;
  /** Destroys it. Only a deleted pane should reach this. */
  close: (paneId: PaneId) => Promise<void>;
};

/**
 * What the WebKit store held afterwards, not what was posted to it — the shell
 * reads the store back because `set_cookie` reports nothing about whether
 * WebKit accepted a cookie.
 */
export type CookieImportReport = {
  /** How many rows the shell was handed. */
  received: number;
  /** How many of them were found in the cookie store afterwards. */
  stored: number;
  /** Domains with at least one cookie missing. The user still has to log in. */
  failedDomains: string[];
};

/** `reason` is prose, except for the stable literal `"not-native-host"`. */
export type CookieImportResult =
  | { ok: true; report: CookieImportReport }
  | { ok: false; reason: string };

/** Mirrors `cookie_import` in `src-tauri/src/cookie_import.rs`. */
export type NativeCookieBridge = {
  /**
   * Plants cookies in the store every pane webview shares, so the import is
   * wall-wide rather than per pane. Never throws: outside the shell there is no
   * store to write to, which is an answer, not a failure.
   */
  importCookies: (
    cookies: readonly SessionCookie[],
  ) => Promise<CookieImportResult>;
};

/**
 * True inside the Tauri shell. Tauri injects this object into every webview it
 * creates, including ones pointed at an http origin like ours.
 */
export function isNativeHost(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const nativePaneBridge: NativePaneBridge = {
  show: (paneId, url, rect) =>
    invoke("pane_webview_show", { paneId, url, rect }),
  place: (paneId, rect, visible) =>
    invoke("pane_webview_place", { paneId, rect, visible }),
  close: (paneId) => invoke("pane_webview_close", { paneId }),
};

export type NativeCookieBridgeDeps = {
  invoke: (
    command: string,
    args: Record<string, unknown>,
  ) => Promise<CookieImportReport>;
  isNative: () => boolean;
};

export function createNativeCookieBridge(
  deps: NativeCookieBridgeDeps,
): NativeCookieBridge {
  return {
    importCookies: async (cookies) => {
      if (!deps.isNative()) return { ok: false, reason: "not-native-host" };
      if (cookies.length === 0) {
        return { ok: true, report: { received: 0, stored: 0, failedDomains: [] } };
      }
      try {
        const report = await deps.invoke("cookie_import", { cookies });
        return { ok: true, report };
      } catch (error) {
        return { ok: false, reason: messageOf(error) };
      }
    },
  };
}

/** A rejected `invoke` carries the command's `Err(String)`, not an `Error`. */
function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  return error instanceof Error ? error.message : String(error);
}

export const nativeCookieBridge: NativeCookieBridge = createNativeCookieBridge({
  invoke: (command, args) => invoke(command, args),
  isNative: isNativeHost,
});
