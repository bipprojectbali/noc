/**
 * The pane's full URL is on screen only while the user is editing it.
 *
 * A wall is screen-shared and screenshotted, and a dashboard URL can carry a
 * token in its path or query. So the menu shows the host behind ✎, and every
 * tooltip in the chrome names the host only. Assertions read the chrome's
 * markup, not the document: the iframe's `src` holds the URL by design.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppShell } from "../../src/app/app.shell.tsx";
import { useWallStore } from "../../src/pane/pane.store.ts";
import { resetWallStore, settleAsyncWork } from "../fixtures/wall-store.ts";

const ROOT = "root";
const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ verdict: "allowed", reason: "no framing headers present" }),
      { headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
  resetWallStore(ROOT);
});

afterEach(async () => {
  await settleAsyncWork();
  cleanup();
  globalThis.fetch = realFetch;
});

async function loadUrl(paneId: string, url: string): Promise<void> {
  await act(async () => {
    useWallStore.getState().submitUrl(paneId, url);
  });
}

function click(testId: string): void {
  fireEvent.click(screen.getByTestId(testId));
}

function openMenu(paneId: string): void {
  click(`pane-menu-button-${paneId}`);
}

/** Submit is fired on the form: happy-dom does not bubble it up from the input. */
function typeAndSubmit(raw: string): void {
  const input = screen.getByLabelText(`URL for pane ${ROOT}`);
  fireEvent.change(input, { target: { value: raw } });
  fireEvent.submit(input.closest("form")!);
}

describe("the full URL is on screen only while it is being edited", () => {
  const SECRET_URL = "https://dash.example.test/d/abc?token=s3cret";

  function chromeHtml(): string {
    // Scoped to the chrome: the iframe's `src` legitimately holds the URL.
    return screen.getByTestId(`pane-chrome-${ROOT}`).innerHTML;
  }

  test("opening the menu shows the host behind ✎, and no field", async () => {
    render(<AppShell />);
    await loadUrl(ROOT, SECRET_URL);

    openMenu(ROOT);

    const menu = screen.getByTestId(`pane-menu-${ROOT}`);
    expect(menu.querySelector("input")).toBeNull();
    expect(chromeHtml()).not.toContain("s3cret");
    expect(chromeHtml()).not.toContain("/d/abc");
    const edit = screen.getByTestId(`pane-url-edit-${ROOT}`);
    expect(edit.textContent).toContain("dash.example.test");
    expect(document.activeElement).toBe(edit);
  });

  test("tooltips name the host only", async () => {
    render(<AppShell />);
    await loadUrl(ROOT, SECRET_URL);
    openMenu(ROOT);

    expect(
      screen.getByTestId(`pane-menu-button-${ROOT}`).getAttribute("title"),
    ).toBe("dash.example.test");
    const rows = screen
      .getByTestId(`pane-menu-${ROOT}`)
      .querySelectorAll('[data-testid^="pane-site-row-"]');
    expect(rows.length).toBe(1);
    expect(rows[0]!.getAttribute("title")).toBe("dash.example.test");
  });

  test("✎ shows the full URL, focused, ready to edit", async () => {
    render(<AppShell />);
    await loadUrl(ROOT, SECRET_URL);
    openMenu(ROOT);

    click(`pane-url-edit-${ROOT}`);

    const input = screen.getByLabelText(`URL for pane ${ROOT}`) as HTMLInputElement;
    expect(input.value).toBe("https://dash.example.test/d/abc?token=s3cret");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByTestId(`pane-url-edit-${ROOT}`)).toBeNull();
  });

  test("a valid submit hides the field again and shows the new host", async () => {
    render(<AppShell />);
    await loadUrl(ROOT, SECRET_URL);
    openMenu(ROOT);
    click(`pane-url-edit-${ROOT}`);

    await act(async () => typeAndSubmit("https://other.example.test/x?token=s3cret"));
    // A good address closes the menu; the next open is back behind ✎.
    expect(screen.queryByTestId(`pane-menu-${ROOT}`)).toBeNull();
    openMenu(ROOT);

    expect(screen.queryByLabelText(`URL for pane ${ROOT}`)).toBeNull();
    expect(screen.getByTestId(`pane-url-edit-${ROOT}`).textContent).toContain(
      "other.example.test",
    );
    expect(chromeHtml()).not.toContain("s3cret");
  });

  test("the url changing elsewhere while editing hides the field", async () => {
    render(<AppShell />);
    await loadUrl(ROOT, SECRET_URL);
    openMenu(ROOT);
    click(`pane-url-edit-${ROOT}`);

    await loadUrl(ROOT, "https://elsewhere.example.test/");

    expect(screen.queryByLabelText(`URL for pane ${ROOT}`)).toBeNull();
    expect(screen.getByTestId(`pane-url-edit-${ROOT}`).textContent).toContain(
      "elsewhere.example.test",
    );
  });

  test("a rejected submit keeps the field open with what was typed", async () => {
    render(<AppShell />);
    await loadUrl(ROOT, SECRET_URL);
    openMenu(ROOT);
    click(`pane-url-edit-${ROOT}`);

    typeAndSubmit("javascript:alert(1)");

    const input = screen.getByLabelText(`URL for pane ${ROOT}`) as HTMLInputElement;
    expect(input.value).toBe("javascript:alert(1)");
    expect(
      screen.getByRole("alert", { hidden: true }).textContent,
    ).toContain("Only http and https");
  });

  test("an empty pane shows the field at once, focused", () => {
    render(<AppShell />);

    openMenu(ROOT);

    const input = screen.getByLabelText(`URL for pane ${ROOT}`);
    expect(document.activeElement).toBe(input);
    expect(screen.queryByTestId(`pane-url-edit-${ROOT}`)).toBeNull();
  });

  test("Add site… shows an empty field", async () => {
    render(<AppShell />);
    await loadUrl(ROOT, SECRET_URL);
    openMenu(ROOT);

    click(`pane-site-add-${ROOT}`);

    const input = screen.getByLabelText(
      `New site URL for pane ${ROOT}`,
    ) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(chromeHtml()).not.toContain("s3cret");
  });
});
