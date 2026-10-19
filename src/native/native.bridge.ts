/**
 * The seam between the wall page and the native shell.
 *
 * The wall is served over http, so it runs identically in a browser and inside
 * the Tauri shell. Everything that only exists in the shell is reached through
 * this file, and `isNativeHost` is the one place that asks which one we are in.
 */

import { invoke } from "@tauri-apps/api/core";

import type { PaneId } from "../layout/layout.types.ts";

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
