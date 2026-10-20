# NOC wall

A tiling wall of panes, each showing a website. Built with Bun, React, React
Router (library mode) and Zustand.

## Status

The wall renders a tree of panes with a draggable splitter between every pair.
Splits and deletion are wired through the store and proven not to disturb a
pane's iframe. Panes can also be rearranged after the fact: drag one by its ⋮
onto another pane's edge to land beside it, or onto its middle to trade the two
places, with no page reloading either way. A pane's whole chrome is now one ⋮
button, floating over the top-right corner of an iframe pane and costing it no
height at all; it opens a dropdown holding the address field, the renderer
picker, Reload, Split right, Split down and Close. Each pane can be drawn as an
iframe or as a native webview, and a webview pane keeps a 20px seam for its
button because an OS-level view cannot be drawn over. A pane can also hold
several pages at once: every one of them stays loaded, the switch sits on the
pane next to ⋮ in the same shape — a dot per page while there are four or
fewer, a `3/8` chip that steps and wraps past that — and the page being left
is hidden rather than torn down. Every page a pane holds is saved, and a wall
saved before this opens with the address it had as its first page. The menu
also carries
Import cookies, which signs every native pane in at once from a browser
export. A page on the wall may also ask for the camera and the microphone,
which it previously could not; in the desktop app that only works from a built
app, not from `tauri:dev`. All of it is built and unit-tested; none of it has
been seen on screen. The desktop shell is real: it runs the server as a
sidecar, puts a native webview in each pane, and now leaves a pane on the page
it is showing when the wall page itself reloads instead of sending it back to
its stored address.

| Milestone | State |
| --- | --- |
| M1 — one pane with URL bar, load state, explicit refusal state | done |
| M2 — pure tree engine: split, delete, resize, dock, invariants | done |
| M3 — tree rendering with a stable flat pane layer | done |
| M4 — splitter and drag resize | done for iframe panes, see below |
| M5 — per-pane controls: one floating ⋮, one dropdown | built and unit-tested; not yet seen on screen, see below. ⋮ is also the handle that drags a pane elsewhere on the wall, same status, and the switch between the pages one pane holds sits beside it in the same shape. Minimise and the dock strip were dropped from the UI |
| M6 — freeze and suspend policy | not started; hiding a webview already suspends it for free, see below |
| M7 — persistence and saved views | layout restores on reload and saves on change; saved views not started |
| M8 — native webview renderer (Tauri) | panes render, respond and navigate, and now sit where they belong; a pane is also meant to stay on the page it is showing when the wall page reloads, which has not been watched yet, and the switch that picks the renderer is built but not yet seen on screen, see below |

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

**Why a pane asks you to log in again, and which half of that is fixable.** The
two renderers fail for different reasons, and only one of them is ours to
answer. A pane drawn as an **iframe** is a cross-site context: an ordinary
`SameSite=Lax` session cookie is in the browser's jar and is simply never sent
there. Nothing in this app can change that, and copying the cookie in would not
help, because it is not the cookie that is missing — it is the browser's
willingness to attach it. Only the site can lift that, by issuing the cookie as
`SameSite=None; Secure; Partitioned`. A pane drawn as a **native webview** is a
top-level document, where `SameSite` does not apply, and that is where the
import works: export cookies from your own browser with any extension that
writes a Netscape `cookies.txt` or a JSON array, pick the file from "Import
cookies…" in any pane's menu, and they are planted in the WebKit store every
pane webview shares. One import therefore covers the whole wall. Every pane is
reloaded afterwards, because a cookie planted under a page already on screen
changes nothing until that page is fetched again. The shell reads the store
back and reports what it really holds rather than what was posted to it, since
`set_cookie` is fire-and-forget a layer below and reports nothing; domains that
did not take are named, because those are the sites still to be signed into by
hand. Never run — see "Open items".

### Layout library

Evaluated `dockview` and chose not to adopt it. Its React bindings live in
`dockview-react`, it mounts fine, and it would have saved the splitter work.
But by the time the question was settled the tree engine was already written
and tested, so the saving was spent; adopting it would instead have cost
deleting working code and migrating the persist format. Nothing structural
depends on the choice, so it can be revisited cheaply.

## Requirements

- Bun 1.2.17 or newer (HTML imports must work with `bun build --compile`).
- Rust toolchain — needed for the desktop shell (`bun run tauri:dev`), not for
  the browser build.

## Run

```sh
bun install
bun run dev          # http://127.0.0.1:7788
```

Open the wall at **`http://wall.noc.localhost:7788/`**, not at `127.0.0.1`.
Both addresses reach the same server, but only the first lets a framed site
keep you signed in: panes are served through sibling addresses of that name,
which is what stops the browser treating them as a different site and
withholding their session cookies. No `/etc/hosts` entry is needed — Chrome
resolves any `*.localhost` name to loopback on its own. A wall opened at
`127.0.0.1` still works and says so in the corner; the desktop app loads the
loopback address and does not need any of this, because its panes are real
windows.

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
| `NOC_DATA_DIR` | `.noc-data` | Directory that holds the wall database. Relative to the working directory, so the default only makes sense for `bun run dev`/`start`. The Tauri shell fills it in with the OS per-application data directory (`~/Library/Application Support/dev.noc.wall`) unless you set it — a bundled app is launched with its working directory at `/`, where nothing can be written. |
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
  pane/      pane UI (⋮ button, menu and drag-to-rearrange), URL handling, load state machine, store, pane layer
  resize/    splitter, drag arithmetic, pane pointer suppression seam
  server/    entrypoint, routes, header probe
  session/   cookie import: export parser (pure), its own store, menu item
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

That run measured the chrome as it was then: two rows, a URL bar and a button
row. The chrome has since shrunk twice — to one thin strip, and then to a
single ⋮ that an iframe pane pays nothing for and a webview pane carries in a
20px seam. The band above the page is shorter each time. What was established
is the arithmetic, which does not care how tall the chrome is; the exact rows
above are a record of that run, not a prediction about the current build.

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

### 1. The floating ⋮ and its menu have never been on screen

**Known.** This is the second redesign, not a first build. The two permanent
rows every pane used to carry — a URL bar above the body, a button row below it
— made the wall unusable past a few panes. The thin strip that replaced them
was cheaper but still a seam: a wall of panes read as stitched together, and a
wall put on monitors is looked at far more than it is operated. So the strip is
gone and with it the host label, which now survives only as the button's
tooltip.

What is left is one ⋮. Over an **iframe** pane it floats in the top-right
corner, absolutely positioned and shrink-wrapped, so the body runs edge to edge
and the only part of the page it can cover is a 24px square; it sits at 14%
opacity until the pane is hovered, the button is focused, or the menu is open,
and it carries its own dark fill and hairline ring so it stays legible over a
white dashboard and a dark one alike. Over a **native webview** pane none of
that is possible — an OS-level view paints above the whole web layer and
ignores CSS — so that pane alone keeps a 20px seam holding nothing but the
button. The choice is made per pane from the renderer actually serving it
(`pane.frame.tsx`), never once for the wall, because a wall can hold both.

The button opens an ordinary desktop dropdown: fixed 224px, hung under the
button and aligned to it, with the address field and the renderer picker
sharing one geometry at the top, Reload, Split right and Split down as 28px
rows, and Close last in the danger colour. Enter submits the address; there is
no Go button. Right-click opens the same menu on the chrome and on an empty
pane's message — not over a loaded page, which is a platform limit and not an
omission: a cross-origin iframe never hands `contextmenu` to its parent, and a
native webview takes the event at OS level where the web layer never sees it.
Minimise and the dock strip are gone from the UI; `dockPane`, `undockPane` and
`setUrlBarVisible` stay in the store with docblocks saying so, because removing
them is a database schema change rather than a delete.

The panel is an overlay, which this codebase otherwise forbids, and it is
allowed only because it holds the splitter drag's suppressor for as long as it
is open: every native webview on the wall is hidden while a menu is up. Hiding
is not destroying, so those pages keep running and return at the same scroll
position. No fourth `invoke` and no native menu were added — the cheap path
first, revisited only if the blanking proves annoying.

**Not known.** Everything visual. The suite runs under happy-dom, which measures
every element at zero width and height, so none of its 329 passing tests
says that an iframe pane's body really runs edge to edge, that the ⋮ is legible
over an actual bright website or lost over a dark one, that 14% opacity is
"nearly invisible" rather than "invisible", that the 224px dropdown fits inside
a narrow pane instead of running off its edge, that the 20px seam is enough to
click in, that the buttons are reachable with a native webview on the wall, or
that the blanking is tolerable to look at.

**Next step.** Run `bun run tauri:dev` on a layout of at least three panes, two
of them native webviews, and look at five things. That an iframe pane shows no
seam at all while a webview pane shows its 20px one, and that the ⋮ is findable
on both without being a distraction on either. That ⋮ opens
the panel, that the panel is actually on screen rather than hidden behind a
webview, and that the URL field inside it is usable at the narrowest pane the
wall will make. That Split right and Split down produce the split they name
without reloading the neighbouring page, and that Close removes both the pane
and its native webview. That the menu closes on all of Escape, a click outside,
and a second press of ⋮, with the webviews coming back each time and no pane
left blank afterwards. And the one thing no amount of code reading can answer:
whether every webview on the wall going blank each time a menu opens reads as a
reasonable cost or as the app flickering — open and close a menu a dozen times
while the other panes hold live pages and judge it. If it is intrusive, the
alternative is a native menu behind a fourth `invoke`.

Then run `bun run dev` in a browser for the part the desktop app hides: there
are no native webviews there, so nothing blanks, and the floating ⋮, the
dropdown, the outside-click dismissal and right-click on an empty pane can be
checked on their own — over real sites of both brightnesses. The Webview option must appear disabled rather than missing.

### 2. The renderer switch has never been on screen

**Known.** Each pane's menu has a `<select>` choosing Iframe, Webview or
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
left painting over the wall. The label's old warning that a webview hides the
pane's own bar on macOS has been dropped — it was true only while
`chrome_height()` returned zero, and the chrome a pane has now is a strip above
the webview's anchor, never across it. "reloads" stays in the label, because
switching really does reload.

### 3. Cookie import has never been on screen, and no cookie has ever been planted

**Known.** The pieces exist and are unit-tested end to end in isolation: the
parser reads both export shapes and drops a bad row without losing the good
ones around it, the bridge turns a rejected `invoke` into a result rather than
a throw, the store parses then imports then reloads every pane with an address,
and the menu row is disabled outside the shell with the reason written on it.
The Rust side compiles — `cargo check` passes, and the command is registered in
both places it has to be, `COMMANDS` in `build.rs` and the capability file.

**Not known.** Everything that only a run can answer. `cargo run` has not
happened, so no cookie has ever reached `WKWebsiteDataStore` from this code:
whether WebKit accepts the cookies as written, whether the read-back identity
match (name, host without its leading dot, value) recognises what WebKit
normalised, whether a wall-wide reload of several webviews at once is smooth or
a stampede, and whether a real export from a real extension parses at all —
every fixture in the suite was written by hand. Nor has the row been seen: not
its place in the 224px dropdown, not the file dialog over a native pane, not
the outcome text at that width when several domains failed.

**Next step.** `bun run tauri:dev` with two native panes on a site you are
signed into in your own browser, export that browser's cookies, and import
them. Three things to watch: that the count reported is plausible rather than
zero, that the panes come back signed in after the automatic reload, and that
a deliberately broken file produces the worded error instead of silence. Then
put the same site in an iframe pane and confirm it still asks for a login —
that is the expected result, not a regression.

### 4. Dragging a pane has never been on screen

**Known.** The gesture shares the ⋮ with the menu, because there is no other
surface to share it with: a press on a pane's page is heard by the site and
never by this app, under either renderer. Four pixels of travel separates the
two gestures. Dropping against an edge of another pane puts the dragged pane on
that side of it; dropping in the middle — the central 40% of each axis, the
smaller share on purpose, since a swap moves two panes and is the expensive
mistake — trades their places. The tree operations behind both are pure and
never mint a pane id, which is what keeps the pages from reloading, and the
wall commits the whole move in one write so no pane is ever briefly slotless.
Every way out is covered: Escape, a cancelled pointer, the window losing focus,
and the dragged pane being deleted while its own button is still held.

**Not known.** What it is like to use. While the drag runs it holds the same
suppressor the splitter and the menu hold, so every native webview on the wall
is blank for the duration — which is exactly what makes drawing the drop
feedback possible, and also what might make the gesture unpleasant. Each pane
therefore gets a thin ring and its host name, and nothing has confirmed that
the ring is visible over a bright dashboard and over a dark one alike, that the
name fits a narrow pane rather than being clipped to an ellipsis that says
nothing, or that the shaded landing area reads as "the pane will go here". Nor
whether four pixels is the right threshold on a trackpad, where a press is far
less steady than on a mouse — too low and every click on ⋮ risks becoming a
tiny drag, which would make the menu feel broken.

**Next step.** `bun run tauri:dev` on at least four panes, two of them native
webviews and two of them bright pages. Drag one pane onto each of the four
edges of another and confirm it lands on the side the shading promised; drag
one onto a middle and confirm the two swap without either page reloading.
Click ⋮ twenty times without meaning to drag and confirm the menu opens every
time. Then judge the blanking the way entry 1 asks it to be judged, and count
how many of the blank panes you can still name from the ring and label alone.

### 5. The wall no longer bounces, but nothing has watched it stop

**Known.** A wheel an iframe pane cannot absorb chains out to the wall
document, and macOS answers it there with an elastic bounce of the whole grid.
The wall document is a fixed set of viewports and was never taller than the
window — measured, not assumed — so the fix refuses the chaining
(`overscroll-behavior: none`) and removes any scroll it could find
(`overflow: hidden`) rather than removing an overflow that was never there.
Both properties matter: panes are placed in viewport coordinates and nothing
listens for scroll, so a document that moved at all would drag every pane off
its slot. Native webview panes never chained here in the first place.

**Not known.** Whether it is gone. This is a removal of the cause by
construction, not an observation of an effect disappearing: headless Chrome
does not rubber-band, so no test could have watched the bounce and no test can
watch it stop.

**Next step.** `bun run dev` in Safari or Chrome on macOS with one pane showing
a page shorter than the pane, and spin the wheel hard over it. The wall must
not move. Then a page taller than the pane, to confirm that the pane itself
still scrolls and only the wall is locked.

### 6. A long hide, and `<video>` and WebSocket under one, are not measured

**Known.** What the source says, above: hidden means not visible, which suspends
`requestAnimationFrame` and aligns timers to about 1 Hz.

**Not known.** Whether throttling deepens over minutes, and whether `<video>`
playback and WebSocket traffic are treated specially.

**Next step.** One pane running a `setInterval` and a `requestAnimationFrame`
that each write a timestamp, hidden for five minutes and then shown. The gaps in
the two logs answer it.

### 7. `createdAt` is monotonic only against the values it issued itself

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

### 8. Loose ends found while verifying, still open

The three code-level ones from this list are now closed: `sidecar_env()` passes
`NOC_DB_FILE` through, the dead `{kind:"error"}` variant is gone from
`PaneLoadState`, and `deletePane` calls `geometryRegistry.forget()`. What is
left is the two that were only ever observations.

- Seen once: the layout's `sizes` moved on their own from `[0.5, 0.5]` to
  `[0.5976, 0.4024]` when another application took the window focus. No cause
  established.
- ~~After a URL is typed, `currentUrls` reads `null` for both panes while
  `node.url` is set.~~ Closed, by deletion. The observation was right and the
  field was never able to hold anything else: load state only ever carries a
  url we set ourselves, because a cross-origin frame never reports where it
  navigated. `currentUrls` is gone from `WallSnapshot`, and `panes.current_url`
  is a legacy column alongside `home_url` — still in the schema, because
  dropping a SQLite column means rebuilding the table, but no longer written
  or read.

### 9. Several pages in one pane: switching is tested, the control is not

**Known.** A pane holds a list of sites and mounts every one of them at once,
stacked in the body's single grid cell with all but the active one hidden —
`visibility: hidden` for an iframe, the existing `visible` flag for a native
webview. Nothing is ever unmounted or closed to switch, and that part is
checked rather than asserted: the iframe tests compare element identity across
a switch, and the native test proves `pane_webview_close` is never sent while
one page is being swapped for another. Load state moved with it: it is the
page's state now, keyed by site.

The control takes the same shape as ⋮, because the end user asked for exactly
that after seeing a third shape: pips (or a `3/8` counter past four pages) in
the same chrome container, floating over an iframe pane and seated in the seam
of a webview pane. The ⋮ panel lists the pages by name and is the only place
that can add one, reusing the panel's single field in "add" mode.

**Not known.** Everything about how it looks. The pip row is arithmetic — 8px
pips, 4px gaps, so `12n − 4` px against a pane that can be ~96px wide, and ⋮
has to fit beside it — computed against a stylesheet no test loads, in a DOM
that measures every element as zero. Unverified: that pips and ⋮ both fit on
the narrowest pane a wall will make, that a pip at 0.28 opacity reads as
"another page is here" without reading as grime, that the active pip is
distinguishable at a glance from a monitor's distance, that `12n − 4` is
honest about the gap CSS actually renders, and whether four is the right place
to give up on pips. Also unmeasured: what N live pages per pane costs, since a
wall of four panes holding three sites each is twelve documents, and a hidden
webview is cheap but a hidden iframe is only throttled.

**One step.** Open the wall, give one pane three sites, and look at the pane
at its narrowest. Then watch the memory of a wall holding a dozen pages.

Four is also only a guess. It is where dots are expected to stop being
something a pointer can hit, chosen on arithmetic alone; nobody has yet tried
to click the fourth dot on a narrow pane, or seen whether the jump from four
dots to a `3/8` chip reads as the same control or as a different one.

**Watched, on a native pane.** A wall of two panes was run in the desktop app,
one pane rendered as a native webview holding two pages. Both pips and ⋮ were
visible in that pane's seam and both pips took a click. Each page carried a
load counter, a document-open timestamp, a live scroll readout and a text
field. Page B's timestamp was 12 ms after page A's, so both webviews were
created when the wall loaded rather than on the switch. Stepping to B and back
left A's counter at one, its timestamp unchanged, its scroll at 2355 and its
typed text intact, and the same held for B. Only the active page was on
screen; the hidden sibling was absent from the accessibility tree entirely,
which is what `setHidden:` does. The ⋮ panel opened over that pane, listed both
pages and offered "Add site…", with every webview on the wall blanked for as
long as it was open — the designed cost, seen rather than assumed. What this
run did **not** cover: adding a third page from that panel, removing one, the
renderer switch, or anything about how the arithmetic above renders.

### 10. The camera reaches a framed pane — measured; the report that started this never reproduced

**Known, and seen this time.** A real Chrome with a real camera, driven over
the devtools protocol, was pointed at a pane framing the `@vladmandic/human`
demo — the same dashboard that had been logging `REQUESTED DEVICE NOT FOUND`
in a loop. On the direct host and on the proxy host alike the frame reported
`allowsFeature("camera") === true`, two video inputs from `enumerateDevices()`,
`getUserMedia` resolving, and the demo reaching "starting detection". The
demo's own constraint shapes (`facingMode`, `aspectRatio` from the pane's body
box) were replayed inside the frame and all five resolved. So the delegation
on the frame works, and it works through the proxy hostname too.

**Known by removal.** Taking the `allow` attribute off produced
`NotAllowedError: Permission denied`, an empty allowlist, and Chrome's
"Permissions policy violation: camera is not allowed in this document". That
is the failure this codebase is capable of causing — and it is *not* the one
that was reported.

**Fixed, and it is a different hole from the one reported.** A site may veto
the camera for itself with `Permissions-Policy: camera=()`, and delegation
cannot overrule that; a stand-in serving exactly that header measured
`allowsFeature === false`, `permission: denied`, `NotAllowedError`. The proxy
now removes `camera` and `microphone` from that header (and from the legacy
`Feature-Policy`), leaving every other directive standing. The same stand-in,
same browser, same minute: through the proxy host `policy=true … getusermedia=ok`,
framed from `127.0.0.1` where no proxy sits, still
`policy=false … NotAllowedError: Permission denied`. None of the real sites on
the wall send that header, so this closes a hole nobody had hit yet.

**Not known.** Why the original `NotFoundError` happened. It could not be
reproduced on any host with the current tree, and no path in this repo can
produce that error — the only failure here is `NotAllowedError`. The most
likely story is that those panes predate the `allow` attribute, but that state
yields `NotAllowedError` too, so it stays a guess. If the loop returns, the
cheapest discriminator is still `enumerateDevices()` inside the frame: zero
devices means the app never got to ask, a non-empty list means the constraint
did not match.

**Also a decision, not an oversight.** Any page on the wall may ask, with no
per-pane switch — making it per-pane means a new field on a pane, which is a
stored-format change rather than a toggle. In a browser you still get asked.

**Untouched.** The native renderer. The Tauri path is parked, so
`Info.plist`, the entitlements and `on_permission_request` are unexamined and
nothing here says a device reaches a native pane.

### 11. A pane keeping its page across a wall reload has never been watched

**Known.** What was wrong and why nothing in the page could fix it. Reloading
the wall sent every native pane back to its stored address, so a pane that had
just been signed into came back on a login form — which reads as a broken
login, because nothing on screen says the wall was what reloaded. The record
of where each pane had already been sent lived in the wall page, and the wall
page took it with it, leaving the shell nothing to compare against. That
record now belongs to the shell, which outlives any number of page reloads,
and the frontend states whether it wants a navigation or only a new rectangle.

**Not known.** Whether it holds. Nothing in the test suite can see this: the
behaviour is the shell's, and the shell is not under test.

**The cost of the rule, and who pays it.** Not navigating a pane that is
already where it was asked to be means a reload has to say out loud that it
means to replace the page, because a reload is exactly a repeat of the address
a pane is already on. Reload does say it, and so does the reload of every pane
that follows a cookie import, which that import depends on entirely. The thing
to know before adding to this: anything new that asks the shell to show a page
and means "fetch it again" has to say so too, or it becomes a no-op with
nothing to show that it did nothing. Moving a pane must not say it. That the
frontend says it where it should is tested; what the shell does with it is not.

**One step.** `bun run tauri:dev`, sign into a site in a native pane, then
Cmd-R the wall page: the pane must stay on the page it was showing. Then press
Reload in that pane's menu and confirm the page really is fetched again.

### 12. A framed pane keeps its session, but only a stand-in has proved it

**Known.** This one was watched in a real browser, which is rare here, so what
is known is unusually concrete. A framed site could not hold a login, and no
amount of client code could change it: a cookie with no `SameSite` is treated
as `Lax`, and the browser computes "site" from the top-level document, so a
framed site on its own domain accepted `Set-Cookie` and then sent every later
request without it. The only move left inside the app was to stop being
cross-site — the wall now answers on `wall.noc.localhost` and serves each site
through a sibling of that name, which the browser counts as the same site.

Three runs, same wall, same site, in Chrome 155 against a throwaway profile,
screenshots kept: through the proxy the pane went from a login form, to signed
in, to **still signed in after a full reload of the wall page**; the control
run with the wall opened at `127.0.0.1` sat on the login form at all three
points, and the browser had stored no cookie for that host at all; a third run
against a site sending `X-Frame-Options: SAMEORIGIN` and
`frame-ancestors 'none'` framed and signed in normally. Chrome's own cookie
store showed two separate host-only cookies, one per site address, which is
cookie isolation demonstrated rather than merely unit-tested.

**Not known.** Everything beyond that stand-in. No real dashboard has been
through this path. Four things are known to be able to break it and none is
handled: a page that builds its own links or XHR from its real origin rather
than from `location` steps off the same-site path, and nothing rewrites
response bodies; a site that validates `Origin` or `Referer` strictly may
answer with a CSRF error, which looks exactly like the login bounce this was
built to cure; an authenticated WebSocket is proved only as far as an echo
demo; and service workers, whose scope is per origin and would therefore
register under the proxy address, have not been touched. A login that bounces
out to a third-party SSO host also leaves the proxy mid-flight, deliberately —
rewriting a redirect to a host nobody put on the wall would turn this into an
open relay.

**One step.** Open `http://wall.noc.localhost:7788/` and point a pane at a real
internal dashboard that bounces to login. Sign in, reload the wall, and watch
whether the pane comes back signed in. Where it fails, the question worth
answering first is which of the four above did it.
