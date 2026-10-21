# NOC wall

A tiling wall of panes, each showing a website. Built with Bun, React, React
Router (library mode) and Zustand. It runs as a web app, installs as a PWA, and
ships as a single executable file.

## Status

The wall renders a tree of panes with a draggable splitter between every pair.
Splits and deletion are wired through the store and proven not to disturb a
pane's iframe. Panes can also be rearranged after the fact: drag one by its ⋮
onto another pane's edge to land beside it, or onto its middle to trade the two
places, with no page reloading either way. A pane's whole chrome is one ⋮
button floating over its top-right corner, costing the pane no height at all;
it opens a dropdown holding the address field, a zoom row, Reload, Split right,
Split down and Close. The zoom row steps the page along the browser's own
ladder, 50% to 200%, so a dashboard built for a full screen can be shrunk until
it fits or a small number enlarged until it is legible from across the room;
the level belongs to the page rather than the pane, and is saved with it. A
pane can hold several pages at once: every one of them stays loaded, the switch
sits beside ⋮ — a dot per page while there are four or fewer, a `3/8` chip that
steps and wraps past that — and the page being left is hidden rather than torn
down.

A framed site can keep you signed in, which is the thing this wall exists to
do and the thing a plain iframe cannot: every site is served through a sibling
address of the wall's own, so the browser counts it as the same site and stops
withholding its session cookie. A page on the wall may also ask for the camera
and the microphone.

| Milestone | State |
| --- | --- |
| M1 — one pane with URL bar, load state, explicit refusal state | done |
| M2 — pure tree engine: split, delete, resize, dock, invariants | done |
| M3 — tree rendering with a stable flat pane layer | done |
| M4 — splitter and drag resize | done, confirmed in a browser |
| M5 — per-pane controls: one floating ⋮, one dropdown | built and unit-tested; not yet seen on screen, see below. ⋮ is also the handle that drags a pane elsewhere on the wall, same status, and the switch between the pages one pane holds sits beside it in the same shape. Minimise and the dock strip were dropped from the UI |
| M6 — freeze and suspend policy | not started |
| M7 — persistence and saved views | layout restores on reload and saves on change; saved views not started |
| M8 — native webview renderer (Tauri) | **withdrawn and deleted.** See "Why the desktop app is gone" |
| M9 — same-site proxy so a framed pane holds a session | done, confirmed in a browser against a stand-in site |
| M10 — ships as a PWA and as a single-file binary | built; neither install nor compiled-binary rendering has been seen, see below |

**What a browser confirmed.** Geometry no longer rests on injected rects alone.
Against Chromium, with three panes on screen: slots measure non-zero, every pane
host lands on exactly its slot's rect, resizing the container re-places all three
through `ResizeObserver` with no change to the tree, and splitting a pane leaves
its neighbour's iframe at the same rect, on the same DOM node and parent,
without firing a single `load`.

**How the drag crosses a pane.** While a drag is live the panes stop taking the
cursor, which is what lets the pointer cross a pane instead of being swallowed
by it: a class on `<body>` paired with a `pointer-events` rule. In a browser, a
held-button drag was carried across an iframe pane in both directions, from the
splitter into the right pane and back across the left one. The splitter followed
the pointer to the predicted fraction in each case, and a plain hover after
release moved nothing.

## Why the desktop app is gone

There was a Tauri shell that ran the server as a sidecar and drew each pane as
a native child webview. It has been deleted outright — no `src-tauri`, no
`@tauri-apps` dependency, no native renderer, no second code path to keep in
step.

It existed for two jobs. The first was sites that refuse to be framed, and the
second was holding a login session inside a pane. The same-site proxy does both,
in a browser, with no toolchain to install: a site served through the wall's own
sibling address cannot be refused by `X-Frame-Options`, because the wall *is*
its origin, and the same move is what lets its cookie come back. With both jobs
answered in one layer, a second renderer bought nothing and cost a native view
that painted over every overlay in the app — which is why pane chrome used to
reserve a 20px seam, why opening a menu blanked every pane on the wall, and why
a third of the invariants in `CLAUDE.md` existed at all. All of that is gone
with it.

**One thing really was lost: cookie import.** The shell could plant a browser's
exported cookies straight into the WebKit store every pane shared, which signed
the whole wall in at once. There is no browser equivalent. The replacement, if
it is ever wanted, is injecting cookies at the proxy instead — a new feature
with its own security argument to make, not a port of the old one. It was left
lost rather than quietly half-rebuilt.

### Layout library

Evaluated `dockview` and chose not to adopt it. Its React bindings live in
`dockview-react`, it mounts fine, and it would have saved the splitter work.
But by the time the question was settled the tree engine was already written
and tested, so the saving was spent; adopting it would instead have cost
deleting working code and migrating the persist format. Nothing structural
depends on the choice, so it can be revisited cheaply.

## Requirements

Bun 1.2.17 or newer — HTML imports must work with `bun build --compile`. That
is the whole list; there is no native toolchain any more.

## Run

```sh
bun install
bun run dev          # http://127.0.0.1:7788
```

Open `http://localhost:7788/` and the browser is taken on to
**`http://wall.noc.localhost:7788/`**. Both addresses reach the same server
and the same wall — the layout is in the database — but only the second lets
a framed site keep you signed in: panes are served through sibling addresses
of that name, which is what stops the browser treating them as a different
site and withholding their session cookies. No `/etc/hosts` entry is needed —
Chrome resolves any `*.localhost` name to loopback on its own. Add `?stay=1`
to stay on the loopback address on purpose (sessions in panes will break
there, which is the point of having it). A wall bound to a routable address is
never moved, since the loopback name would point at the reader's own machine.

| Script | Does |
| --- | --- |
| `bun run dev` | Dev server with hot reload |
| `bun run start` | Same server, no hot reload |
| `bun test` | Full suite |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run build:binary` | One standalone executable for this machine, in `dist/` |
| `bun run build:binary:all` | Six cross-target executables; the release build |

### Install it as an app

The wall declares a web manifest, so a Chromium browser offers to install it,
and the installed window has no address bar, no tabs and no browser chrome —
which is the window a wall-mounted monitor wants and the one the deleted
desktop app used to supply. Installing from `http://wall.noc.localhost:<port>/`
works without TLS: a `*.localhost` name counts as a secure context.

There is no service worker, deliberately. Chrome stopped requiring one for
installability, and there is nothing here for one to do: every pane is a live
page on another origin that a wall-origin worker can neither see nor cache, and
a cached shell would outlive the binary serving it — a recompiled wall would
ship new assets to clients still holding the old ones.

### Fullscreen on a chosen monitor

A wall usually wants fullscreen on a *particular* screen, not on whichever one
the window happens to sit on. Where the browser supports the Window Management
API the control lists the monitors by name and sends the wall to the one you
pick; everywhere else it falls back to ordinary fullscreen. Granting the
permission is what makes the names appear, so the control asks for it only when
you use it.

### Ship it as one file

`bun run build:binary` produces a single executable with the server, the
frontend bundle, the manifest and the icons inside it. Nothing is installed on
the target machine and no Bun toolchain is needed there, which is the point: a
monitoring wall is set up by whoever runs the monitoring, often on a container
image or a rack box. `--all` cross-compiles the six targets for a release.

The binary keeps its database in the per-user data directory the OS means
(`~/Library/Application Support/dev.noc.wall` on macOS, `%APPDATA%` on Windows,
`XDG_DATA_HOME` or `~/.local/share` elsewhere) rather than beside wherever it
was launched from. `NOC_DATA_DIR` still overrides it.

## Configuration

Every environment-derived value lives in `src/config/config.env.ts`.

| Variable | Default | Notes |
| --- | --- | --- |
| `NOC_HOST` | `127.0.0.1` | Loopback on purpose. See the warning below. |
| `NOC_PORT` | `7788` | Startup fails if taken; it never silently moves. `0` takes any free port. |
| `NOC_DATA_DIR` | depends | `.noc-data`, relative to the working directory, under `bun run dev`/`start`. In a compiled binary it is the per-user data directory above, because an executable is often launched with its working directory somewhere unwritable. |
| `NOC_DB_FILE` | `noc.sqlite` | Database file name inside `NOC_DATA_DIR`. |
| `NOC_LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug`. |

> **Binding to `0.0.0.0` exposes more than the UI.** The embeddability probe
> makes the server fetch URLs supplied by the client, and the saved layout names
> your internal dashboards. On a wider interface, anyone who can reach the port
> can use both.

## Three things that drive the whole design

**An iframe may never change parent in the DOM.** Splitting a pane changes its
parent, which makes React recreate the DOM node, which reloads the site. So the
layout tree and the panes are two separate layers: the tree renders empty slots,
and panes live in one flat list whose order never changes, positioned from slot
geometry. This is why `splitPane` keeps the original pane's id.

**Refusal cannot be detected from the client.** A frame blocked by
`X-Frame-Options` still fires `load` in Chromium, and its document is not
readable. So framing permission is classified server-side from the target's
response headers (`/api/embeddability`), and on the direct path nothing strips
or rewrites a header — a refusal is reported to the user, not worked around.

**A pane can only hold a session if its site is same-site with the wall.** A
cookie with no `SameSite` is treated as `Lax`, and the browser computes "site"
from the top-level document, so a framed site accepts `Set-Cookie` and then
never sends it back. The proxy exists for that one reason; sites that refuse
framing loading as a side effect is a consequence of it, not its purpose.

## Layout

```
src/
  app/       React shell, router, and the three CSS layers
  config/    environment handling
  display/   screen enumeration and fullscreen on a named monitor
  embed/     embeddability classification (pure)
  geometry/  rect maths, host registry, slot-to-pane sync
  layout/    pane tree: types, pure ops, zoom ladder, invariants, serializer, renderer
  pane/      pane UI (⋮ button, menu and drag-to-rearrange), URL handling, load state machine, store, pane layer
  persist/   SQLite repository, migrations, snapshot and writer
  proxy/     same-site reverse proxy: site labels, header rules, registry, HTTP and websocket
  pwa/       web manifest, icons, and the head tags that announce them
  resize/    splitter, drag arithmetic, pane pointer suppression seam
  server/    entrypoint, routes, per-host dispatch, header probe
tests/       mirrors src/, plus recorded header fixtures
```

`src/server/server.entry.ts` is the only server entrypoint, shared by the dev
server and the compiled binary.

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

**Known.** This is the third shape, not a first build. The two permanent rows
every pane used to carry — a URL bar above the body, a button row below it —
made the wall unusable past a few panes. The thin strip that replaced them was
cheaper but still a seam: a wall of panes read as stitched together, and a wall
put on monitors is looked at far more than it is operated. So the strip is gone
and with it the host label, which now survives only as the button's tooltip.
The 20px seam a native pane used to need went with the native renderer.

What is left is one ⋮, floating in the top-right corner, absolutely positioned
and shrink-wrapped, so the body runs edge to edge and the only part of the page
it can cover is a 24px square; it sits at 14% opacity until the pane is hovered,
the button is focused, or the menu is open, and it carries its own dark fill and
hairline ring so it stays legible over a white dashboard and a dark one alike.

The button opens an ordinary desktop dropdown: fixed 224px, hung under the
button and aligned to it, with the address field at the top, a zoom row, Reload,
Split right and Split down as 28px rows, and Close last in the danger colour.
Enter submits the address; there is no Go button. Right-click opens the same
menu on the chrome and on an empty pane's message — not over a loaded page,
which is a platform limit and not an omission: a cross-origin iframe never hands
`contextmenu` to its parent. Minimise and the dock strip are gone from the UI;
`dockPane`, `undockPane` and `setUrlBarVisible` stay in the store with docblocks
saying so, because removing them is a database schema change rather than a
delete.

**Not known.** Everything visual. The suite runs under happy-dom, which measures
every element at zero width and height, so none of its passing tests says that
a pane's body really runs edge to edge, that the ⋮ is legible over an actual
bright website or lost over a dark one, that 14% opacity is "nearly invisible"
rather than "invisible", or that the 224px dropdown fits inside a narrow pane
instead of running off its edge.

**Next step.** `bun run dev`, a layout of at least three panes over real sites
of both brightnesses, and five things to look at. That the body shows no seam at
all and the ⋮ is findable without being a distraction. That ⋮ opens the panel
and the URL field inside it is usable at the narrowest pane the wall will make.
That Split right and Split down produce the split they name without reloading
the neighbouring page, and that Close removes the pane. That the menu closes on
all of Escape, a click outside, and a second press of ⋮. And that right-click
reaches the menu on the chrome and on an empty pane.

### 2. Dragging a pane has never been on screen

**Known.** The gesture shares the ⋮ with the menu, because there is no other
surface to share it with: a press on a pane's page is heard by the site and
never by this app. Four pixels of travel separates the two gestures. Dropping
against an edge of another pane puts the dragged pane on that side of it;
dropping in the middle — the central 40% of each axis, the smaller share on
purpose, since a swap moves two panes and is the expensive mistake — trades
their places. The tree operations behind both are pure and never mint a pane id,
which is what keeps the pages from reloading, and the wall commits the whole
move in one write so no pane is ever briefly slotless. Every way out is covered:
Escape, a cancelled pointer, the window losing focus, and the dragged pane being
deleted while its own button is still held.

**Not known.** What it is like to use. Each pane gets a thin ring and its host
name while a drag runs, and nothing has confirmed that the ring is visible over
a bright dashboard and over a dark one alike, that the name fits a narrow pane
rather than being clipped to an ellipsis that says nothing, or that the shaded
landing area reads as "the pane will go here". Nor whether four pixels is the
right threshold on a trackpad, where a press is far less steady than on a mouse
— too low and every click on ⋮ risks becoming a tiny drag, which would make the
menu feel broken.

**Next step.** `bun run dev` on at least four panes, two of them bright pages.
Drag one pane onto each of the four edges of another and confirm it lands on the
side the shading promised; drag one onto a middle and confirm the two swap
without either page reloading. Then click ⋮ twenty times without meaning to drag
and confirm the menu opens every time.

### 3. Several pages in one pane: switching is tested, the control is not

**Known.** A pane holds a list of sites and mounts every one of them at once,
stacked in the body's single grid cell with all but the active one hidden
(`visibility: hidden`). Nothing is ever unmounted to switch, and that part is
checked rather than asserted: the tests compare element identity across a
switch. Load state moved with it — it is the page's state now, keyed by site.

The control takes the same shape as ⋮, because the end user asked for exactly
that after seeing a third shape: pips, or a `3/8` counter past four pages, in
the same chrome container. The ⋮ panel lists the pages by name and is the only
place that can add one, reusing the panel's single field in "add" mode.

**Not known.** Everything about how it looks. The pip row is arithmetic — 8px
pips, 4px gaps, so `12n − 4` px against a pane that can be ~96px wide, and ⋮
has to fit beside it — computed against a stylesheet no test loads, in a DOM
that measures every element as zero. Unverified: that pips and ⋮ both fit on
the narrowest pane a wall will make, that a pip at 0.28 opacity reads as
"another page is here" without reading as grime, that the active pip is
distinguishable at a glance from a monitor's distance, and whether four is the
right place to give up on pips — that number is where dots are *expected* to
stop being something a pointer can hit, chosen on arithmetic alone. Also
unmeasured: what N live pages per pane costs, since a wall of four panes holding
three sites each is twelve documents, and a hidden iframe is only throttled.

**One step.** Open the wall, give one pane three sites, and look at the pane at
its narrowest. Then watch the memory of a wall holding a dozen pages.

### 4. The wall no longer bounces, but nothing has watched it stop

**Known.** A wheel an iframe pane cannot absorb chains out to the wall
document, and macOS answers it there with an elastic bounce of the whole grid.
The wall document is a fixed set of viewports and was never taller than the
window — measured, not assumed — so the fix refuses the chaining
(`overscroll-behavior: none`) and removes any scroll it could find
(`overflow: hidden`) rather than removing an overflow that was never there.
Both properties matter: panes are placed in viewport coordinates and nothing
listens for scroll, so a document that moved at all would drag every pane off
its slot.

**Not known.** Whether it is gone. This is a removal of the cause by
construction, not an observation of an effect disappearing: headless Chrome
does not rubber-band, so no test could have watched the bounce and no test can
watch it stop.

**Next step.** `bun run dev` in Safari or Chrome on macOS with one pane showing
a page shorter than the pane, and spin the wheel hard over it. The wall must
not move. Then a page taller than the pane, to confirm that the pane itself
still scrolls and only the wall is locked.

### 5. `createdAt` is monotonic only against the values it issued itself

**Known.** `nextCreatedAt()` carries its own `lastCreatedAt` and never reads the
tree. `restoreLayout` puts a stored tree straight into the store, so a layout
saved while the system clock was ahead — a clock that moves backwards between
sessions — can hold a `createdAt` larger than `Date.now()`. The first pane
created after that restore would tie with it or sort before it, and the reorder
of the flaky-test story above comes back.

**Not known.** Whether a clock ever moves backwards here. It has not been
observed.

**Next step.** Seed `lastCreatedAt` from the largest `createdAt` in the restored
tree, about two lines in `src/pane/pane.store.ts`. Left undone on purpose: the
case is unproven.

### 6. Loose ends found while verifying, still open

- Seen once: the layout's `sizes` moved on their own from `[0.5, 0.5]` to
  `[0.5976, 0.4024]` when another application took the window focus. No cause
  established.
- `parseWallSnapshot` accepts a pane with no `createdAt`, so the save fails
  later as a 500 (`NOT NULL constraint failed: panes.created_at`) instead of
  being refused at the boundary with a 400.
- `scripts/binary.build.ts` treats any unrecognised flag as a target name, so
  `bun run build:binary --minify` tries to build `--target=bun---minify`.

### 7. The camera reaches a framed pane — measured; the report that started this never reproduced

**Known, and seen.** A real Chrome with a real camera, driven over the devtools
protocol, was pointed at a pane framing the `@vladmandic/human` demo — the same
dashboard that had been logging `REQUESTED DEVICE NOT FOUND` in a loop. On the
direct host and on the proxy host alike the frame reported
`allowsFeature("camera") === true`, two video inputs from `enumerateDevices()`,
`getUserMedia` resolving, and the demo reaching "starting detection". The demo's
own constraint shapes were replayed inside the frame and all five resolved.

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
produce that error. The most likely story is that those panes predate the
`allow` attribute, but that state yields `NotAllowedError` too, so it stays a
guess. If the loop returns, the cheapest discriminator is still
`enumerateDevices()` inside the frame: zero devices means the app never got to
ask, a non-empty list means the constraint did not match.

**Also a decision, not an oversight.** Any page on the wall may ask, with no
per-pane switch — making it per-pane means a new field on a pane, which is a
stored-format change rather than a toggle.

### 8. A framed pane keeps its session, but only a stand-in has proved it

**Known.** This one was watched in a real browser, which is rare here, so what
is known is unusually concrete. Three runs, same wall, same site, in Chrome 155
against a throwaway profile, screenshots kept: through the proxy the pane went
from a login form, to signed in, to **still signed in after a full reload of the
wall page**; the control run with the wall opened at `127.0.0.1` sat on the
login form at all three points, and the browser had stored no cookie for that
host at all; a third run against a site sending `X-Frame-Options: SAMEORIGIN`
and `frame-ancestors 'none'` framed and signed in normally. Chrome's own cookie
store showed two separate host-only cookies, one per site address, which is
cookie isolation demonstrated rather than merely unit-tested.

Getting to that address is no longer the reader's job, and that was watched the
same way. A later pair of runs typed `http://localhost:<port>/` and nothing
else: the browser landed on `http://wall.noc.localhost:<port>/`, the pane went
login form → signed in → **still signed in after a full reload of the wall
page**, and `?stay=1` kept a second navigation on `127.0.0.1`. The control, the
same wall opened with `?stay=1` and a site addressed as a genuinely different
name, read signed out at all three points. Both runs used a scratch port rather
than 7788, so as not to collide with a wall already running.

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

**A note on `?stay=1`.** The flag used to be written automatically onto the
address the desktop shell was handed, which is how the shell stayed on
loopback. With the shell gone it has no producer left in the code at all — it is
now something a person types, and the one thing in the repo that still needs it
is this project's own cross-site control page, which only says anything when
the wall is reached without the proxy. It is kept for that reason and should not
be mistaken for dead code.

**One step.** Open the wall and point a pane at a real internal dashboard that
bounces to login. Sign in, reload the wall, and watch whether the pane comes
back signed in. Where it fails, the question worth answering first is which of
the four above did it.

### 9. Zoom works, and was watched working, against a stand-in page

**Known.** Measured in Chrome 155 driving the real wall, not a test harness, in
a 1400×788 pane framing a grid of 100px cells. At 100% the framed page reported
an inner viewport of 1398×786 with 32 cells on screen. At 50% the same pane
reported 2796×1572 and **64 cells** — zoom out really adds content rather than
only shrinking type, which is the entire point and the thing a paint-level
scale would have failed. At 200%, 20 cells and an inner viewport of 699×393.

Clicks land where they look. The same screen point, 150px into the pane on both
axes, hit `c5` at 100% and `c10` at 50% — exactly the cell at the inner
coordinate the magnification implies — and at 200%, with the page scrolled,
`c128`, which is again precisely right once the scroll offset is counted. A
wheel of 400px at 50% moved the framed page 800px, so scrolling works at a
factor that is not 1. The magnification is written on the `<iframe>` element
itself: the host above it, which carries the geometry layer's transform, stays
untouched.

It survives a reload. Set to 200%, the wall page was reloaded in the browser
and the pane came back at 200%, factor and readout both. It belongs to the page
and not to the pane: with two pages in one pane, stepping the second to 80% left
the first sitting at 200%, and the readout followed the switch between them. A
marker written into the first page's DOM was still there afterwards, so neither
magnifying nor switching reloaded it.

The control fits. The panel measures 224px, the zoom row 216×36 inside it, four
pixels of margin to spare.

**Not known.** The stand-in problem again: no real dashboard has been magnified
through this. A page that sets its own viewport, or that lays out from
`window.innerWidth` on a resize it never sees, may not behave like a plain grid.
Legibility from across a room — the reason the feature exists — has not been
judged on an actual wall-mounted monitor, only in a window on a desk. There is
no keyboard shortcut and no pinch: the panel is the only way in, which is a
cross-origin limit rather than a choice, but whether operators find three clicks
acceptable is unanswered.

**One step.** Point a pane at a real dashboard built for a full screen, step it
to 50%, and read it from where the wall is actually watched. If something
reflows wrongly, the first thing to check is whether the page sizes itself from
`innerWidth` at load rather than on the resize the magnification causes.

### 10. Nobody has ever installed the PWA

**Known.** The manifest is complete for Chromium installability — 192 and 512
icons, a maskable one padded into its safe zone rather than letterboxed,
`start_url` and `scope` at the wall root, and an `id` pinned to the same string
so a later path move cannot produce a second installed app beside the first.
Everything is served, and that part was checked against a running compiled
binary rather than reasoned about: the manifest comes back byte-identical to the
frozen object with Bun's own `application/manifest+json`, the four icons come
back as real PNGs, the wall document carries all three head tags, and a proxied
site asking for the same paths gets a 404 instead of the wall's.

**Not known.** Whether any browser has ever offered to install it. No installed
window has been opened, the maskable icon has never been seen in a dock or a
launcher, and nothing confirms that a chrome-less window is actually the better
wall — which is the entire claim this replaces the desktop app with.

**One step.** Open the wall in Chrome, install it from the address bar, and look
at the installed window on the monitor the wall will live on. Then reopen it the
next day and confirm it comes back with the same layout.

### 11. Fullscreen on a named monitor is the least-tested thing here

**Known.** The control probes the Window Management permission on mount and
enumerates screens only when asked, because enumerating prompts and a prompt
before the fullscreen call would eat the user activation. Without the API it
falls back to plain `requestFullscreen` with no branch, since a browser that
does not know the screen dictionary ignores it.

**Not known.** Nearly all of it. happy-dom reports exactly one unnamed screen
and has no `requestFullscreen` at all, so the multi-monitor path — the reason
this exists — has no coverage whatsoever. The control has never been on screen,
no permission prompt has been seen, and no wall has been sent to a second
monitor by name.

**One step.** Open the wall on a machine with two monitors, grant the
permission, and send it to the one it is not on. Then revoke the permission and
confirm the fallback still fullscreens somewhere rather than failing.

### 12. The binary serves, but no browser has rendered from it

**Known.** The compiled binary has been run, not reasoned about: launched from
a scratch directory and from `/`, it answered the landing 307, served the shell,
the concatenated minified CSS and the JS chunk, the manifest and its icons,
self-test, embeddability, and full layout and saved-view round trips — then was
killed, restarted from `/` again, and came back with the same wall, having
created nothing in either directory. That last part matters: a relative data
directory in a compiled binary resolves against the process working directory,
which is the bug the deleted desktop app shipped once.

**Not known.** Whether the wall actually renders from it. Every check above was
HTTP; no browser has loaded the compiled, minified bundle and drawn a pane from
it. Six cross-target binaries compile and only the host one has been executed,
so nothing says a Linux or Windows build starts at all.

**One step.** Run `./dist/noc`, open the address it prints in a browser, and
make a pane. Then run one cross-target build on the platform it was built for.
