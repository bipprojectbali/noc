/**
 * The tags cannot live in `index.html` — Bun's bundler rejects them there — so
 * they are inserted into the served document, and the thing worth guarding is
 * that they actually arrive, inside the head. A manifest link that silently
 * fails to be added costs nothing visible: the wall still loads, it just stops
 * being installable, and no browser says why.
 */

import { describe, expect, test } from "bun:test";

import { withPwaHead } from "../../src/pwa/pwa.head.ts";
import { WEB_MANIFEST_PATH } from "../../src/pwa/pwa.manifest.ts";

describe("the install tags", () => {
  test("land inside the head, not after the document", () => {
    const html = withPwaHead(
      "<!doctype html><html><head><title>NOC wall</title></head><body></body></html>",
    );

    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    expect(head).toContain(`<link rel="manifest" href="${WEB_MANIFEST_PATH}">`);
    expect(head).toContain(`<meta name="theme-color"`);
    expect(head).toContain(`rel="apple-touch-icon"`);
  });

  test("keep what the bundler already wrote in the head", () => {
    const html = withPwaHead(
      '<html><head><link rel="stylesheet" href="/chunk.css"></head><body></body></html>',
    );
    expect(html).toContain('<link rel="stylesheet" href="/chunk.css">');
  });

  test("both icon sizes are declared to the browser chrome too", () => {
    const html = withPwaHead("<html><head></head><body></body></html>");
    expect(html).toContain(`sizes="192x192"`);
    expect(html).toContain(`sizes="512x512"`);
  });

  test("a document without a head passes through untouched", () => {
    // Which is what Bun serves in the frontend's place when it fails to build:
    // nothing here should turn that page into something stranger.
    expect(withPwaHead("build failed")).toBe("build failed");
  });

  test("a head closed in capitals is still a head", () => {
    // Hand-written HTML elsewhere in this repo does this, and inserting after
    // the document instead of into it is a silent failure, not a loud one.
    expect(withPwaHead("<HTML><HEAD></HEAD></HTML>")).toContain(
      `href="${WEB_MANIFEST_PATH}"`,
    );
  });
});
