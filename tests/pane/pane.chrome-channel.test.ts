/**
 * The one part of the pane-chrome transport that can be proven here.
 *
 * Whether a `BroadcastChannel` actually crosses two WKWebViews is a question for
 * a running shell and nothing else; what this file holds is the boundary on this
 * side of it. The chrome page is another document, so every message it sends is
 * input from outside — and the wall acts on it, by opening a menu or switching
 * which page a pane shows. A parser that let a malformed or unknown message
 * through would be acting on nothing.
 */

import { describe, expect, test } from "bun:test";

import { parsePaneChromeRequest } from "../../src/pane/pane.chrome-channel.ts";

describe("a message from a pane's chrome webview", () => {
  test("names what to do and which page it is about", () => {
    expect(parsePaneChromeRequest({ type: "open-menu", siteId: "site-a" })).toEqual({
      kind: "open-menu",
      siteId: "site-a",
    });
    expect(parsePaneChromeRequest({ type: "activate-site", siteId: "site-b" })).toEqual({
      kind: "activate",
      siteId: "site-b",
    });
    expect(parsePaneChromeRequest({ type: "hello", siteId: "site-c" })).toEqual({
      kind: "hello",
      siteId: "site-c",
    });
  });

  test("an unknown word is not a request", () => {
    // The wall announces on the same channel, so its own messages come past
    // this parser in every other pane. They have to read as nothing.
    expect(
      parsePaneChromeRequest({ type: "pane-sites", sites: ["site-a"], activeId: "site-a" }),
    ).toBeNull();
    expect(parsePaneChromeRequest({ type: "close-pane", siteId: "site-a" })).toBeNull();
  });

  test("a request about no page at all is not a request", () => {
    // Without a site id there is nothing to check it against, and the filter on
    // the far side is the whole reason one pane cannot operate another.
    expect(parsePaneChromeRequest({ type: "open-menu" })).toBeNull();
    expect(parsePaneChromeRequest({ type: "open-menu", siteId: "" })).toBeNull();
    expect(parsePaneChromeRequest({ type: "open-menu", siteId: 7 })).toBeNull();
  });

  test("anything that is not a message is not a request", () => {
    expect(parsePaneChromeRequest(null)).toBeNull();
    expect(parsePaneChromeRequest(undefined)).toBeNull();
    expect(parsePaneChromeRequest("open-menu")).toBeNull();
    expect(parsePaneChromeRequest(["open-menu", "site-a"])).toBeNull();
    expect(parsePaneChromeRequest({})).toBeNull();
  });

  test("a prototype key is not a word this parser knows", () => {
    // The lookup is an object literal, so without this the string "constructor"
    // would resolve to a function and read as a kind.
    expect(parsePaneChromeRequest({ type: "constructor", siteId: "site-a" })).toBeNull();
    expect(parsePaneChromeRequest({ type: "toString", siteId: "site-a" })).toBeNull();
  });
});
