# Changelog

## [Unreleased]

### Added

- Controls on every pane, behind one thin strip. The strip shows the site's
  host — or "Empty" — and a ⋮ button; the button opens a panel with the
  address field, Reload, the renderer picker, Split right, Split down and
  Close. Right-click on the strip, or anywhere in an empty pane, opens the
  same menu. Right-click over a loaded page cannot: a framed site keeps the
  event to itself, and a native pane takes it before the app sees it. The
  strip is deliberately small, because a wall is meant to hold many panes and
  every pane pays for its own chrome. Built and unit-tested, not yet seen on
  screen; see "Open items" in the README.

- While a pane's menu is open, every pane drawn as a native webview goes
  blank, and comes back when the menu closes. This is how the menu is able to
  appear at all — in the desktop app a native pane paints over anything drawn
  on top of it. The pages are only hidden, never stopped: they keep running
  and return at the scroll position they were left at.

- A renderer picker in each pane's menu: draw that pane as an iframe, as a
  native webview, or leave it on automatic. The webview is what puts a site
  that refuses to be framed on the wall, so a refused pane now says to try it;
  outside the desktop app the option is shown disabled rather than hidden.
  Switching reloads the page in that pane, which the control says before you
  pick it. Built and unit-tested, not yet seen on screen; see "Open items" in
  the README.

- A splitter between the two halves of every split. Drag it to change how the
  space is shared; Escape puts the split back where it was. The panes stop
  taking the cursor for the length of the drag, so the pointer can cross a pane
  without the drag dying — for panes drawn as iframes. A native webview takes
  mouse input outside the browser's reach, so that case is still open.

- The wall reloads the layout you left. Changes are saved as you make them,
  and a layout that cannot be loaded is never overwritten by the empty wall
  shown in its place. The notice above the wall says when saving is off.

### Changed

- Pane geometry is now confirmed against a real browser rather than only
  against injected rects: panes land on their slots, and a window resize
  re-places them.

### Fixed

- A pane in the desktop app no longer covers its own chrome. Every native pane
  sat one title bar too high, hiding the controls above it and leaving a band
  of bare wall underneath it. Measured off screenshots before and after, and
  again after moving and resizing the window.

- Creating a pane no longer disturbs the pages already on the wall. Two panes
  created in the same millisecond could come out in the wrong order, which moved
  a pane that was already on screen and reloaded the site inside it. The order
  panes were created in is now kept exactly, so the page in a pane stays put.

- `NOC_DB_FILE` now takes effect in the desktop app. The server read the
  setting but the app never passed it on, so the database always landed under
  the default name.

- Closing a pane now releases what it held for its position on the wall,
  instead of keeping it until the app exits.

## [0.2.0] - 2026-10-19

### Added

- The wall now renders a tree of panes instead of a single pane. The tree is
  drawn as empty slots, and panes are placed over them, so a pane's iframe
  keeps the same DOM node through every layout change.
- Splitting, docking, undocking, deleting and resizing are available through
  the store. No controls on screen yet.
- Geometry module: rect arithmetic, a host registry kept outside React, and a
  sync pass that copies slot rects onto panes without re-rendering.

### Changed

- Deleting a pane now also discards its load state and validation message,
  instead of leaving them for whatever pane comes next.

### Removed

- Evaluated and dropped the `dockview` dependency. See the README for why.

### Added

- A single pane that loads a URL, with a URL bar you can hide and show, a
  reload button, and input validation that rejects anything other than `http`
  and `https`.
- An explicit refusal state: when a site declines to be framed, the pane says
  which header caused it instead of showing an empty box.
- Server-side embeddability probe at `/api/embeddability`, and a built-in
  always-framable page at `/api/self-test` for setup and smoke checks.
- Pane tree engine with split, delete, resize, dock and undock, plus structural
  invariants checked against 8,000 randomly generated operation sequences.
- Versioned layout serialization, so stored layouts can be migrated later.
- Configuration through `NOC_HOST`, `NOC_PORT`, `NOC_DATA_DIR` and
  `NOC_LOG_LEVEL`, defaulting to loopback.
- `bun run build:binary` produces a standalone executable that serves the
  frontend from inside itself.
