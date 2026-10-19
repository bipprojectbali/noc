# NOC wall

A tiling wall of panes, each showing a website. Built with Bun, React, React
Router (library mode) and Zustand.

## Status

The wall renders a tree of panes with a draggable splitter between every pair.
Splits, docking and deletion are wired through the store and proven not to
disturb a pane's iframe. There is still no UI to create or close a pane — that
is M5, and until it lands a splitter only appears on a wall that was split
through the store.

| Milestone | State |
| --- | --- |
| M1 — one pane with URL bar, load state, explicit refusal state | done |
| M2 — pure tree engine: split, delete, resize, dock, invariants | done |
| M3 — tree rendering with a stable flat pane layer | done |
| M4 — splitter and drag resize | done for iframe panes, see below |
| M5 — per-pane controls and the dock strip | not started |
| M6 — freeze and suspend policy | not started |
| M7 — persistence and saved views | not started |
| M8 — native webview renderer (Tauri) | not started |

**What a browser confirmed.** Geometry no longer rests on injected rects alone.
Against Chromium, with three panes on screen: slots measure non-zero, every pane
host lands on exactly its slot's rect, resizing the container re-places all three
through `ResizeObserver` with no change to the tree, and splitting a pane leaves
its neighbour's iframe at the same rect, on the same DOM node and parent,
without firing a single `load`.

**What the drag does not cover yet.** While a drag is live the panes stop taking
the cursor, which is what lets the pointer cross a pane instead of being
swallowed by it. That is solved for iframe panes only. The suppressor is a class
on `<body>` paired with a `pointer-events` rule, and CSS does not reach a native
webview, which is not in the DOM and takes mouse input at the OS level.
`resize.pointer-capture` is a registry so the webview renderer can add its own
suppressor; until it does, dragging across a webview pane is unsolved.

In a browser, a held-button drag was carried across an iframe pane in both
directions, from the splitter into the right pane and back across the left one.
The splitter followed the pointer to the predicted fraction in each case, and a
plain hover after release moved nothing. Whether the body class or the frame's
own pointer routing is what keeps the moves flowing was not separated out.

### Layout library

Evaluated `dockview` and chose not to adopt it. Its React bindings live in
`dockview-react`, it mounts fine, and it would have saved the splitter work.
But by the time the question was settled the tree engine was already written
and tested, so the saving was spent; adopting it would instead have cost
deleting working code and migrating the persist format. It also has no concept
of a dock strip, so it would not have reduced that work at all. Nothing
structural depends on the choice, so it can be revisited cheaply.

## Requirements

- Bun 1.2.17 or newer (HTML imports must work with `bun build --compile`).
- Rust toolchain — only for the Tauri milestone, not needed yet.

## Run

```sh
bun install
bun run dev          # http://127.0.0.1:7788
```

| Script | Does |
| --- | --- |
| `bun run dev` | Dev server with hot reload |
| `bun run start` | Same server, no hot reload |
| `bun test` | Full suite |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run build:binary` | Standalone executable in `dist/noc` |

## Configuration

Every environment-derived value lives in `src/config/config.env.ts`.

| Variable | Default | Notes |
| --- | --- | --- |
| `NOC_HOST` | `127.0.0.1` | Loopback on purpose. See the warning below. |
| `NOC_PORT` | `7788` | Startup fails if taken; it never silently moves. |
| `NOC_DATA_DIR` | `.noc-data` | Reserved for M7 persistence. |
| `NOC_LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug`. |

> **Binding to `0.0.0.0` exposes more than the UI.** The embeddability probe
> makes the server fetch URLs supplied by the client, and the saved layout names
> your internal dashboards. On a wider interface, anyone who can reach the port
> can use both.

## Two things that drive the whole design

**An iframe may never change parent in the DOM.** Splitting a pane changes its
parent, which makes React recreate the DOM node, which reloads the site. So the
layout tree and the panes are two separate layers: the tree renders empty slots,
and panes live in one flat list whose order never changes, positioned from slot
geometry. This is why `splitPane` keeps the original pane's id.

**Refusal cannot be detected from the client.** A frame blocked by
`X-Frame-Options` still fires `load` in Chromium, and its document is not
readable. So framing permission is classified server-side from the target's
response headers (`/api/embeddability`). Nothing strips or rewrites a header —
a refusal is reported to the user, not worked around.

## Layout

```
src/
  config/    environment handling
  embed/     embeddability classification (pure)
  geometry/  rect maths, host registry, slot-to-pane sync
  layout/    pane tree: types, pure ops, invariants, serializer, renderer
  pane/      pane UI, URL handling, load state machine, store, pane layer
  resize/    splitter, drag arithmetic, pane pointer suppression seam
  server/    entrypoint, routes, header probe
tests/       mirrors src/, plus recorded header fixtures
```

`src/server/server.entry.ts` is the only server entrypoint, shared by the dev
server and the compiled binary.
