/**
 * The cookie-import row of the ⋮ menu, from both sides of the host boundary.
 *
 * The store is faked at the registry seam rather than by replacing a module,
 * so the real panel, the real menu and the real `PaneFrame` are all in the
 * test — which is the only way the host branch is exercised at all, since
 * `nativeHost` is decided in `pane.frame` from the same `__TAURI_INTERNALS__`
 * sniff the shell really does.
 *
 * What is NOT covered, and cannot be: clicking the row opens an OS file
 * panel, and happy-dom has none. The test fires the change event the panel
 * would deliver afterwards, which proves everything downstream of the picker
 * and nothing about the picker itself. Nor does a green run here say the
 * panel still fits 224px or that the row is legible — no element in happy-dom
 * has a size.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PaneFrame } from "../../src/pane/pane.frame.tsx";
import {
  setSessionImportHook,
  type SessionImportState,
  type SessionImportStore,
} from "../../src/session/session.store-contract.ts";
import { resetWallStore, settleAsyncWork } from "../fixtures/wall-store.ts";

const PANE = "s1";
const WAIT = { timeout: 2000 };

let state: SessionImportState = { kind: "idle" };
let importedTexts: string[] = [];

function useFakeSessionImport(): SessionImportStore {
  return {
    state,
    importFromText: async (text) => {
      importedTexts.push(text);
    },
  };
}

/** Makes `isNativeHost()` true; the pane renders as a webview, so `invoke` must land. */
function enterNativeHost(): void {
  (globalThis.window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke: () => Promise.resolve(),
  };
}

function leaveNativeHost(): void {
  delete (globalThis.window as unknown as Record<string, unknown>)
    .__TAURI_INTERNALS__;
}

function openMenu(): void {
  fireEvent.click(screen.getByTestId(`pane-menu-button-${PANE}`));
}

function statusText(): string | null {
  return screen.queryByTestId(`pane-import-cookies-status-${PANE}`)?.textContent ?? null;
}

function control(): HTMLButtonElement {
  return screen.getByTestId(`pane-import-cookies-${PANE}`) as HTMLButtonElement;
}

/** Renders a pane with the menu already open, in whatever state was set. */
function openPaneMenu(): void {
  render(<PaneFrame paneId={PANE} />);
  openMenu();
}

beforeEach(() => {
  state = { kind: "idle" };
  importedTexts = [];
  setSessionImportHook(useFakeSessionImport);
  resetWallStore(PANE);
});

afterEach(async () => {
  await settleAsyncWork();
  cleanup();
  setSessionImportHook(null);
  leaveNativeHost();
});

describe("the cookie-import row in a browser", () => {
  test("is offered, disabled, with the host named rather than hidden", () => {
    openPaneMenu();

    expect(control().disabled).toBe(true);
    expect(statusText()).toContain("Desktop app only");
  });

  test("keeps saying so whatever the store reports, because nothing can run", () => {
    state = { kind: "done", stored: 12, skipped: 0, failedDomains: [], at: 1 };
    openPaneMenu();

    expect(control().disabled).toBe(true);
    expect(statusText()).toContain("Desktop app only");
  });
});

describe("the cookie-import row in the native shell", () => {
  beforeEach(() => {
    enterNativeHost();
    resetWallStore(PANE);
  });

  test("is enabled and says nothing until an import has happened", () => {
    openPaneMenu();

    expect(control().disabled).toBe(false);
    expect(control().textContent).toContain("Import cookies");
    expect(statusText()).toBeNull();
  });

  test("hands the file's text to the store and clears the input for a re-pick", async () => {
    const text = "# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t0\tsid\tabc\n";
    openPaneMenu();
    const input = screen.getByTestId(
      `pane-import-cookies-input-${PANE}`,
    ) as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, {
        target: { files: [new File([text], "cookies.txt", { type: "text/plain" })] },
      });
    });

    await waitFor(() => {
      expect(importedTexts).toEqual([text]);
    }, WAIT);
    // Re-exporting and picking the same filename must still fire a change.
    expect(input.value).toBe("");
  });

  test("a change with no file asks the store for nothing", async () => {
    openPaneMenu();

    await act(async () => {
      fireEvent.change(
        screen.getByTestId(`pane-import-cookies-input-${PANE}`),
        { target: { files: [] } },
      );
    });

    expect(importedTexts).toEqual([]);
  });

  test("while importing it says so and cannot be started twice", () => {
    state = { kind: "importing" };
    openPaneMenu();

    expect(statusText()).toBe("Importing cookies…");
    expect(control().disabled).toBe(true);
  });

  test("a clean import reports the count, and pluralises one", () => {
    state = { kind: "done", stored: 182, skipped: 0, failedDomains: [], at: 1 };
    openPaneMenu();

    expect(statusText()).toBe("182 cookies imported.");
    cleanup();

    state = { kind: "done", stored: 1, skipped: 0, failedDomains: [], at: 2 };
    openPaneMenu();

    expect(statusText()).toBe("1 cookie imported.");
  });

  test("dropped rows are named, because a partial import must not look total", () => {
    state = { kind: "done", stored: 182, skipped: 3, failedDomains: [], at: 1 };
    openPaneMenu();

    expect(statusText()).toBe("182 cookies imported, 3 skipped.");
  });

  test("domains WebKit refused are listed, since those still need a manual login", () => {
    state = {
      kind: "done",
      stored: 40,
      skipped: 0,
      failedDomains: ["github.com", "grafana.internal"],
      at: 1,
    };
    openPaneMenu();

    const text = statusText() ?? "";
    expect(text).toContain("40 cookies imported.");
    expect(text).toContain("github.com, grafana.internal");
    expect(text).toContain("sign in there by hand");
  });

  test("every machine reason becomes a sentence, and prose passes through", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["not-native-host", "only works in the desktop app"],
      ["empty-file", "That file is empty."],
      ["unrecognised-format", "neither a cookies.txt export nor a JSON cookie array"],
      ["no-valid-cookies", "every row was malformed"],
      ["cookie store unavailable", "cookie store unavailable"],
    ];

    for (const [reason, expected] of cases) {
      state = { kind: "error", reason };
      openPaneMenu();

      const status = screen.getByTestId(`pane-import-cookies-status-${PANE}`);
      expect(status.textContent).toContain(expected);
      // Failures are announced, not just shown.
      expect(status.getAttribute("role")).toBe("alert");
      cleanup();
    }
  });
});
