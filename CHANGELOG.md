# Changelog

## [Unreleased]

### Added

- A splitter between the two halves of every split. Drag it to change how the
  space is shared; Escape puts the split back where it was. The panes stop
  taking the cursor for the length of the drag, so the pointer can cross a pane
  without the drag dying — for panes drawn as iframes. A native webview takes
  mouse input outside the browser's reach, so that case is still open.

### Changed

- Pane geometry is now confirmed against a real browser rather than only
  against injected rects: panes land on their slots, and a window resize
  re-places them.

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
