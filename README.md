# NOC wall

A tiling wall of panes, each showing a website. Built with Bun, React, React
Router (library mode) and Zustand.

## Status

The wall renders a tree of panes with a draggable splitter between every pair.
Splits, docking and deletion are wired through the store and proven not to
disturb a pane's iframe. Every pane now carries controls that reach those
actions, and each pane can be drawn as an iframe or as a native webview — both
built and unit-tested, neither yet seen on screen. The desktop shell is real:
it runs the server as a sidecar and puts a native webview in each pane.

| Milestone | State |
| --- | --- |
| M1 — one pane with URL bar, load state, explicit refusal state | done |
| M2 — pure tree engine: split, delete, resize, dock, invariants | done |
| M3 — tree rendering with a stable flat pane layer | done |
| M4 — splitter and drag resize | done for iframe panes, see below |
| M5 — per-pane controls and the dock strip | built and unit-tested; not yet seen on screen, see below |
| M6 — freeze and suspend policy | not started; hiding a webview already suspends it for free, see below |
| M7 — persistence and saved views | layout restores on reload and saves on change; saved views not started |
| M8 — native webview renderer (Tauri) | panes render, respond and navigate, and now sit where they belong; the switch that picks the renderer is built but not yet seen on screen, see below |

**What a browser confirmed.** Geometry no longer rests on injected rects alone.
Against Chromium, with three panes on screen: slots measure non-zero, every pane
host lands on exactly its slot's rect, resizing the container re-places all three
through `ResizeObserver` with no change to the tree, and splitting a pane leaves
its neighbour's iframe at the same rect, on the same DOM node and parent,
without firing a single `load`.

**How the drag crosses a pane.** While a drag is live the panes stop taking the
cursor, which is what lets the pointer cross a pane instead of being swallowed
by it. For an iframe pane the suppressor is a class on `<body>` paired with a
`pointer-events` rule. CSS does not reach a native webview, which is not in the
DOM and takes mouse input at the OS level, so the webview renderer registers its
own suppressor in the `resize.pointer-capture` registry: it hides every webview
for the length of the drag and shows them again at the end. Both cases are
covered, and the webview one was since seen working on screen — see below.

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
- Rust toolchain — needed for the desktop shell (`bun run tauri:dev`), not for
  the browser build.

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
| `NOC_PORT` | `7788` | Startup fails if taken; it never silently moves. `0` takes any free port (the Tauri shell does this). |
| `NOC_DATA_DIR` | `.noc-data` | Directory that holds the wall database. |
| `NOC_DB_FILE` | `noc.sqlite` | Database file name inside `NOC_DATA_DIR`. |
| `NOC_PARENT_PID` | unset | Set by the Tauri shell. The server exits when that process is gone. |
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

## What the native shell was seen doing

Run with `bun run tauri:dev`, on a two-pane layout seeded through
`PUT /api/wall`. How each of these was established matters as much as the
result, so it is recorded with them.

**A site renders, responds, and can be navigated again.**
`https://www.youtube.com` rendered in full in a native pane — which an iframe
cannot do, because YouTube refuses to be framed — and `https://example.com` in
the pane beside it. A click put the caret in YouTube's search box and typed
characters arrived in it. A second URL, `https://github.com`, typed into the
same pane navigated that same webview rather than rebuilding it. The `tauri dev`
log carried no error, no warning and no panic. Screenshots of the run exist
outside this repository.

**A pane's page now meets its own chrome, with no overlap and no gap.** This
was the one measured bug left in the shell: every pane sat 28 logical pixels —
exactly one macOS title bar — too high, covering the URL bar it was meant to be
typed into and leaving a band of bare wall beneath it. The cause was not the
arithmetic but what it was reading. Tauri's default `TitleBarStyle::Visible`
asks for `fullSizeContentView`, so the window's content view reaches up behind
the title bar: a frame 875 tall has a content view 875 tall. Every size and
position delta Tauri exposes is therefore zero, which is why the earlier
`outer_size - inner_size` correction added nothing at all. WebKit pushes the
page itself below the bar because it honours the safe area, while `wry` places
a child webview in raw content-view coordinates, so the two disagree by the
height of the bar. `chrome_height()` now reads that height from AppKit
directly — `contentView().frame().size.height` minus the top of
`contentLayoutRect()` — the one number here that is not zero, and zero on a
window without that style.

Established by screenshotting the window by id and counting pixel column run
lengths: title bar rows 0 to 55, the pane border at 56 to 57, pane chrome 58 to
123, and the page from 126 on — no overlap, no gap. The same run lengths came
back after the window was moved and after it was resized, and the pane's URL
bar takes a click again. This adds one macOS-only dependency, `objc2-app-kit`
0.3, at the version tao and wry already pull in.

**Tauri has no per-webview ignore-cursor-events.** The comment the renderer
rests on is correct, checked against the installed crate sources (tauri 2.12.4,
wry 0.57.0, tao 0.37.1). `set_ignore_cursor_events` exists on `Window` and on
`WebviewWindow`, where it only forwards to the window; `Webview` has no such
method and `wry` never mentions it. In tao's macOS backend it maps to
`setIgnoresMouseEvents:` on `NSWindow` — a window property, so it cannot be
scoped to a child webview at all. The nearest alternatives are
`accept_first_mouse`, which is not passthrough, and overriding `hitTest:` on the
raw `WKWebView` through `with_webview`, which is per-webview but hand-rolled.

**Hide and show keep the page, and do not flicker.** Text typed into YouTube's
search box was still there after three hide/show cycles driven by real splitter
drags, pane width changes included, and the page did not reload. There was no
white flash either: while a drag is live, only the wall background shows.

**A hidden webview is suspended by WebKit.** Read from source, not yet measured.
`Webview::hide()` becomes `WebviewMessage::Hide`, then
`webview.set_visible(false)`, then `setHidden:` on the `NSView`, which stays
inside the view hierarchy. WebKit then clears `ActivityState::IsVisible`
(`PageClientImplMac.mm` tests `isHiddenOrHasHiddenAncestor`), which suspends
`requestAnimationFrame`, pauses SVG animation, reports `visibilityState` as
`"hidden"`, and aligns `setTimeout` and `setInterval` to about one second. So
hide and show are a free suspend and resume: a hidden pane burns almost no CPU,
but a chart driven by `requestAnimationFrame` stops dead until `show()`, while
`setTimeout` polling keeps running at roughly 1 Hz. Two notes for M6: Tauri's
`BackgroundThrottlingPolicy` does not govern this case — per Apple's SDK header
it applies to a webview detached from the view hierarchy, and a `setHidden:`
webview is still attached — and an occluded window
(`NSWindowOcclusionState`) freezes its pages the same way hiding does, while a
window that merely loses focus but stays visible does not.

## The flaky test was a product bug, not a test problem

Always the same test — `pane layer order is creation order and never shifts > a
new pane appends after the existing ones` — failing 7 times in 150 runs under
load. `createdAt` is the pane layer's entire ordering key and `Date.now()` only
resolves to the millisecond, so two panes created inside one millisecond tied,
the comparator fell through to the random uuid, and the newer pane sorted first
about half the time: 1,020 of 2,000 iterations. React then moved an
already-mounted host, which re-inserts its iframe and reloads the page inside
it — the exact failure the two-layer design exists to prevent. The test was
right and the code was wrong.

Commit `f6a80c4` gives the store one producer for the key, `nextCreatedAt()` =
`Math.max(Date.now(), lastCreatedAt + 1)`, used by every consumer of the
ordering. A new test forces 20 splits into a single millisecond and fails 5
times out of 5 with the guard reverted. After the fix: 300 clean runs at normal
load, and 100 clean runs with the CPU saturated at a load average of 45. The
earlier mitigation's `PROBE_WAIT_MS = 2000` was deliberately left in place — it
has nothing to do with this cause, and no `waitFor` failed across 550 runs.

## Open items

Each entry says what is known, what is not, and one step that would close it.

### 1. The pane controls and the dock strip have never been on screen

**Known.** Every pane carries a row with Split right, Split down, Minimise and
Close, and a strip under the wall lists minimised panes with Restore and Close.
The store actions behind them were already proven not to disturb a pane's
iframe, and the new UI is covered by tests. The row is a sibling under the pane
body and the strip sits outside `.noc-shell`, both for the reason the chrome
is a sibling: a native webview paints over anything drawn on top of it.

**Not known.** Everything visual. The suite runs under happy-dom, which
measures every element at zero width and height, so nothing green here says the
row is visible, that it has room, that the strip appears when a pane is
minimised, or that the buttons are reachable with a native webview on the wall.

**Next step.** Run `bun run tauri:dev` and look at four things: that the control
row is visible under every pane and is not covered by the page; that Split right
and Split down produce the split they name without reloading the neighbouring
page; that Minimise makes the pane vanish and a labelled entry appear in the
strip below the wall, with the page still running when Restore brings it back;
and that Close removes both the pane and its native webview. Also check the row
while the URL bar is hidden — "Show URL bar" lives there and is the only way
back.

### 2. The renderer switch has never been on screen

**Known.** Each pane's URL bar has a `<select>` choosing Iframe, Webview or
Auto, disabled on the webview option in a plain browser. Switching reloads the
pane's content by design, destroys the old native webview when leaving one, and
skips the embeddability probe for a pane that will be a webview, since no
framing header can refuse a top-level document. A refused pane's message now
points at the switch when the app is native. Tested, including both sides of
the host boundary.

**Not known.** Whether any of it looks or behaves right. Same happy-dom limit as
above, and the native path in particular cannot be exercised in the suite at
all.

**Next step.** Run `bun run tauri:dev` and switch one pane each way: put
`https://www.youtube.com` in a pane set to Iframe, confirm the refusal message
names the header and offers the switch, then pick Webview and confirm the page
appears as a native pane in the same slot while the pane beside it does not
reload. Switch back to Iframe and confirm the native view is gone rather than
left painting over the wall. Note that the option's label still warns that the
webview hides the URL bar on macOS; that was true before the title bar fix
above and should be checked on screen now.

### 3. A long hide, and `<video>` and WebSocket under one, are not measured

**Known.** What the source says, above: hidden means not visible, which suspends
`requestAnimationFrame` and aligns timers to about 1 Hz.

**Not known.** Whether throttling deepens over minutes, and whether `<video>`
playback and WebSocket traffic are treated specially.

**Next step.** One pane running a `setInterval` and a `requestAnimationFrame`
that each write a timestamp, hidden for five minutes and then shown. The gaps in
the two logs answer it.

### 4. `createdAt` is monotonic only against the values it issued itself

**Known.** `nextCreatedAt()` carries its own `lastCreatedAt` and never reads the
tree. `restoreLayout` puts a stored tree straight into the store, so a layout
saved while the system clock was ahead — a clock that moves backwards between
sessions — can hold a `createdAt` larger than `Date.now()`. The first pane
created after that restore would tie with it or sort before it, and the reorder
of the entry above comes back.

**Not known.** Whether a clock ever moves backwards here. It has not been
observed.

**Next step.** Seed `lastCreatedAt` from the largest `createdAt` in the restored
tree, about two lines in `src/pane/pane.store.ts`. Left undone on purpose: the
case is unproven.

### 5. Loose ends found while verifying, still open

The three code-level ones from this list are now closed: `sidecar_env()` passes
`NOC_DB_FILE` through, the dead `{kind:"error"}` variant is gone from
`PaneLoadState`, and `deletePane` calls `geometryRegistry.forget()`. What is
left is the two that were only ever observations.

- Seen once: the layout's `sizes` moved on their own from `[0.5, 0.5]` to
  `[0.5976, 0.4024]` when another application took the window focus. No cause
  established.
- After a URL is typed, `currentUrls` reads `null` for both panes while
  `node.url` is set. Observed, not yet judged.
