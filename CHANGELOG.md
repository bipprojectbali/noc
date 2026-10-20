# Changelog

## [Unreleased]

### Added

- A pane can hold several pages instead of one, and stepping between them is
  not a load. Every page a pane holds stays mounted; the one you step away
  from is hidden, so it comes back with its scroll, its session and its open
  connections intact. Add a page from the address field in a pane's ⋮ panel,
  which also lists by name every page that pane holds and is the only place
  one can be dropped. The switch itself sits on the pane beside ⋮, in the same
  shape ⋮ takes — floating over a framed pane, seated in the seam of a native
  one: up to four pages it is one dot each, and clicking a dot shows that page
  and says which one is on screen; past four it becomes a `3/8` chip that
  steps to the next page and wraps, because dots that small stop being
  something a pointer can hit on a narrow pane. A pane holding one page shows
  no switch at all. A saved wall keeps every page of every pane, and a wall
  saved before this opens with the address it had as its first page. Built and
  unit-tested; the control has never been on screen, and what a wall of a
  dozen live pages costs has not been measured — see "Open items" in the
  README.

- A site on the wall can reach the camera and the microphone. One using
  `getUserMedia` used to report "device not found" in a loop, which was not a
  refusal: it was asking a context that had never been allowed to ask, so it
  was handed no devices to find. Framed panes are now allowed to ask for both.
  For the desktop app the answer was a layer lower — macOS hands no devices
  at all to an app that does not declare why it wants them — so the app now
  declares it and carries the entitlements signing needs. Those only exist in
  a built app: `bun run tauri:dev` does not make one, so capture will keep
  failing there and that failure means nothing. Nothing has yet seen a device
  arrive, or a macOS prompt appear, under either renderer; see "Open items".
  Note while this is new: any page on the wall may ask, there is no per-pane
  switch for it, and inside the desktop app the request is granted without
  asking you.

- Rearrange the wall by dragging a pane. The handle is the same ⋮ the menu
  hangs from: press it and let go and you get the menu as before, press it and
  move and you are carrying the pane. Drop it against the left, right, top or
  bottom of another pane to land beside it there; drop it on that pane's
  middle — the central 40% of each axis — and the two trade places instead.
  Four pixels of travel is the whole difference between the two gestures, so
  nothing changes for anyone who only ever clicks. The ⋮ is the only handle
  there can be: a press anywhere on a pane's page is heard by the site, not by
  this app. Nothing reloads, under either renderer, because a move rewires the
  layout and never gives a pane a new identity. Escape, releasing outside the
  window, or losing focus mid-drag all put the pane back. While a drag runs,
  every pane drawn as a native webview goes blank — the same bargain the
  splitter and the menu already make — so for the length of the gesture every
  pane is outlined and named by its host: without that, a mixed wall would
  read as half of it having broken rather than as panes waiting to be dropped
  on. The pane being carried is dimmed, and the area the pane will actually
  occupy is shaded over the pane about to receive it. Built and unit-tested,
  never seen on screen; see "Open items" in the README.

- Import the cookies from the browser you are already signed into, so a pane
  stops asking you to log in again. Export them with whatever extension you
  already have — a Netscape `cookies.txt` or a JSON array — then pick the file
  from "Import cookies…" in any pane's menu. One import serves the whole wall,
  because every native pane shares a single cookie store, and every pane
  reloads afterwards: cookies planted under a page already on screen change
  nothing until that page is fetched again. The count you are shown is what
  the store really held afterwards rather than what was sent to it, and any
  domain that did not take is named, because those are the sites still waiting
  for a password. This helps panes drawn as a native webview in the desktop
  app, and only those. A framed pane is a cross-site context, where the browser
  holds back the ordinary `SameSite=Lax` session cookie — the cookie is in the
  jar, it is simply never sent — so importing a copy of it changes nothing;
  only the site itself can lift that, by marking the cookie `SameSite=None;
  Secure; Partitioned`. Built and unit-tested, never seen on screen, and no
  cookie has yet been planted in a running app; see "Open items" in the README.

- Controls on every pane, behind a ⋮ button that costs the pane no space. On
  a pane drawn as an iframe the button floats over the page itself and fades
  in when the pointer is over that pane, so a wall at rest shows nothing but
  the sites on it. Only a pane really drawn as a native webview keeps a thin
  seam, because an OS-level view cannot be drawn over; a wall can hold both
  kinds at once. The button opens a dropdown with the address field, Reload,
  the renderer picker, Split right, Split down and Close. Right-click on the
  button opens the same menu, as does right-click anywhere in an empty pane.
  Right-click over a loaded page cannot: a framed site keeps the event to
  itself, and a native pane takes it before the app sees it.

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

- In the desktop app, the pages a pane keeps warm behind the one you are
  looking at no longer flash over it. Opening a page always put it on screen
  first and took it away again a moment later, so every page a pane holds
  flickered across the pane each time the wall page reloaded or a pane was
  reloaded — one flash per page, on a wall where panes hold several. A page
  that belongs behind another is now opened behind it. Unit-tested; nobody has
  watched a wall reload with this in place.

- Reloading the wall no longer throws away where a pane had got to. In the
  desktop app, every pane was sent back to the address it was stored with the
  moment the wall page reloaded, so a pane you had just signed into came back
  showing a login form — which reads as a broken login rather than as a
  reload, since nothing on screen says the wall was the thing that reloaded. A
  pane is now left on the page it is already showing, and only moved. This is
  the desktop app only: a framed pane bounces for a different reason, one that
  belongs to the site being framed. Nothing has watched it hold yet — see
  "Open items" in the README.

- The wheel now stays inside the pane it is used over. A pane whose page fits
  on screen has nothing left to scroll, and the wheel then chained out of the
  pane to the wall behind it, where macOS answered it with an elastic bounce
  of the whole grid. From the operator's seat that read as the pane refusing
  to scroll while the page slid instead. The wall is a fixed set of viewports
  and was never taller than the window — that was measured, not assumed — so
  the fix is to refuse the chaining rather than to remove a scrollbar that was
  never there. Panes drawn as a native webview were never affected: the system
  takes the wheel before the wall sees it. Nothing has watched the bounce stop,
  though; see "Open items" in the README.

- A native pane now goes where the layout sent it. The shell was told a pane's
  new position before the pane had actually been moved, so it measured the
  place the pane was leaving: one frame late at best, and for two panes of the
  same size trading places, late enough to be wrong forever — the stale
  position matched the one already on file, the shell treated the instruction
  as redundant, and one webview never moved while the other sat at its
  neighbour's old place. Nothing corrected it afterwards, because the second
  pass that normally would is triggered by a size change and a swap of equals
  changes no size.

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

### Removed

- The wall no longer claims to remember a page you navigated to inside a pane
  yourself. It was stored beside the pane's own address and preferred over it
  on the way back in, but the two could never differ: the only address the
  wall ever learns is the one it set, and a page that navigates inside a pane
  does so where nothing here can see it. The whole path is gone rather than
  left reading like a feature that works. What this changes for you: nothing
  that ever happened — a pane comes back on the address it holds, exactly as
  before. In the desktop app, the page a pane is showing now survives a wall
  reload for a real reason instead; see "Fixed" above.

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
