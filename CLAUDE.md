# CLAUDE.md — NOC wall

Dinding pane berpetak; tiap pane satu situs. Bun (server + bundler + test runner) · React 19 · react-router 8 **library mode** · zustand 5 · Tauri 2 (`unstable`, multiwebview) · SQLite via `bun:sqlite`. v0.2.0.
README = produk & milestone untuk manusia. File ini = perintah, invariant, jebakan. Jangan saling duplikasi.

## Perintah

- `bun install` · `bun run dev` (hot, http://127.0.0.1:7788) · `bun run start` (tanpa hot)
- `bun test` (18 file `*.test.ts(x)` di `tests/`) · `bun run typecheck` (`tsc --noEmit`)
- `bun run build:sidecar` → `scripts/sidecar.build.ts` menghasilkan `src-tauri/binaries/noc-server-<triple>`; triple dari `rustc --print host-tuple`
- `bun run tauri:dev` / `tauri:build` — keduanya menjalankan `build:sidecar` lewat `beforeDevCommand`/`beforeBuildCommand`
- `bun run build:binary` → `dist/noc` standalone, **bukan** yang dipakai Tauri

## Peta direktori

```
src/config/   satu-satunya pembaca env (config.env.ts)
src/embed/    klasifikasi embeddability, murni, dipakai server & browser
src/geometry/ rect, registry host, sync slot→pane
src/layout/   pohon pane: types, ops murni, invariants, serializer, renderer
src/native/   native.bridge.ts — satu-satunya pintu ke Tauri
src/pane/     UI pane, URL bar, kontrol pane, dock strip, state machine load, store, pane layer, 2 renderer
src/persist/  port persist, client HTTP, repository SQLite, snapshot, writer
src/resize/   splitter, aritmetika drag, seam penekan pointer
src/server/   entrypoint, routes, probe header, ready line, parent watch
src-tauri/src 3 file Rust (403 baris): main.rs, sidecar.rs, pane_webview.rs
tests/        mirror src/ + tests/setup/ + tests/fixtures/
```

`src/server/server.entry.ts` satu-satunya entrypoint server (dev, binary, sidecar). `src/app/app.css` satu-satunya stylesheet, semua kelas ber-prefix `noc-`.

## Invariant yang tidak boleh dilanggar

**1. Iframe tidak boleh berganti parent DOM.** Ganti parent = React bikin node baru = halaman reload. Maka:

- `src/layout/layout.renderer.tsx` merender pohon sebagai flex bersarang yang daunnya **div kosong** ber-`data-pane-slot`. Div kosong itu BUKAN bug — menaruh konten di situ mengikat DOM pane ke bentuk pohon.
- Pane hidup di satu flat list di `src/pane/pane.layer.tsx`, urutannya selalu creation order (`createdAt`, tie-break `id`) dan tidak pernah berubah. Jangan pindahkan pane ke dalam pohon layout, jangan urutkan ulang list ini.
- `src/geometry/geometry.sync.ts` menyalin rect slot ke host pane secara imperatif (`useLayoutEffect` + `ResizeObserver` di `src/app/app.shell.tsx`), memakai `transform: translate(...)` (`geometry.rect.ts:rectToStyle`), bukan `left`/`top`. Jangan posisikan pane lewat state React.
- `splitPane` (`src/layout/layout.tree.ts`) **wajib** mempertahankan id pane asal; hanya split node + pane baru yang dapat id baru.
- Pane tanpa slot disembunyikan (`visibility: hidden`), bukan diberi rect nol — viewport nol membuat halaman reflow dan kehilangan scroll.
- `useShallow` di `usePaneIdsInCreationOrder` wajib; tanpa itu seluruh pane layer re-render tiap perubahan store.

**2. Penolakan framing tidak bisa dideteksi dari client.** Iframe terblokir `X-Frame-Options` tetap memicu `load` di Chromium dan dokumennya tak terbaca. Maka:

- Klasifikasi server-side: `GET /api/embeddability?url=` → `src/server/embed.probe.ts` (fetch target, `body.cancel()`, timeout 8 s) → `src/embed/embed.classifier.ts` (`X-Frame-Options` + CSP `frame-ancestors`). **Tidak ada header target yang di-strip atau ditulis ulang** — penolakan dilaporkan ke user, bukan diakali.
- State pane = reducer murni `src/pane/pane.load-state.ts`: `empty → probing → loading | refused → ready`. Tiap event membawa `url`-nya agar hasil probe untuk alamat lama dibuang. Jangan menambah pembacaan `iframe.contentDocument` atau timer "kalau belum load berarti ditolak".
- Verdict `unknown` sengaja optimistis → `loading`; `probe-failed` juga.
- UI refusal hanya untuk renderer iframe (`framingApplies` di `pane.frame.tsx`); webview native adalah dokumen top-level, batas itu tak berlaku di sana. Teks refusal bercabang pada `isNativeHost()`: di shell ia menyarankan pindah renderer, di browser ia bilang jalan keluarnya cuma ada di desktop app.
- Pane yang benar-benar dirender sebagai webview **tidak** diprobe (`probe` di `pane.store.ts`): fetch-nya takkan dibaca siapa pun. Pane tetap harus keluar dari `probing`, jadi store langsung mengirim `probe-settled` dengan verdict `unknown`.

**3. Child webview native adalah view level OS.** Selalu melukis di atas layer web, mengabaikan CSS clipping dan `pointer-events`. Maka:

- Chrome pane (URL bar, baris kontrol di `src/pane/pane.controls.tsx`) wajib **sibling** dari anchor, bukan overlay — `pane.frame.tsx` + `src/pane/pane.webview-renderer.ts`. Overlay di atas pane tidak akan terlihat sama sekali. Toggle URL bar = event geometri (anchor punya `ResizeObserver` sendiri); karena itu tombol "Show URL bar" tinggal di baris kontrol, bukan di URL bar yang disembunyikan.
- Dock strip (`src/pane/pane.dock.tsx`) hidup **di luar** `.noc-shell`, sebagai sibling di dalam `.noc-wall` (`src/app/app.shell.tsx`). `.noc-shell` adalah ruang koordinat tempat host pane ditaruh; strip di dalamnya akan tertutup webview yang mau dikontrolnya.
- **Hide ≠ destroy.** `pane_webview_place(..., visible=false)` mempertahankan halaman; membuat ulang webview = reload, persis yang desain ini cegah. `pane_webview_close` hanya dari dua tempat: `deletePane` dan `setPaneStrategy` saat pane pindah dari webview ke iframe (React tak bisa melepas view yang tak pernah ada di DOM). Jangan tambah pemanggil ketiga tanpa alasan sekuat itu.
- **`chrome_height()` (`src-tauri/src/pane_webview.rs`) wajib baca AppKit, bukan selisih ukuran window.** Title bar style default Tauri = `fullSizeContentView`, jadi content view membentang sepenuh frame dan `outer_size - inner_size` selalu 0 di macOS — itulah kenapa koreksi aritmetika sebelumnya diam-diam tak berefek. Angka yang benar: `contentView().frame().size.height - (contentLayoutRect().origin.y + contentLayoutRect().size.height)` = 28 px logis. WebKit menggeser halaman turun sesuai safe area, tapi wry menaruh child webview di koordinat content view mentah. Dependency `objc2-app-kit` 0.3 khusus macOS; non-macOS mengembalikan 0.
- **Hide = suspend gratis** (terbukti dari source WebKit, belum diukur): `hide()` → `setHidden:` (view tetap di hierarchy) → WebKit membersihkan `ActivityState::IsVisible`, jadi rAF ter-suspend, animasi SVG pause, `visibilityState` `"hidden"`, `setTimeout`/`setInterval` ter-align ~1 Hz. Pane tersembunyi nyaris nol CPU, tapi chart berbasis rAF mati total sampai `show()`. Knob `BackgroundThrottlingPolicy` Tauri **tidak** mengatur kasus ini — ia hanya berlaku bagi webview yang *detached* dari view hierarchy.
- Selama drag splitter, frontend menyembunyikan semua webview lalu menampilkannya lagi (`createWebviewPointerSuppressor`, depth-counted), karena Tauri 2 hanya punya `setIgnoreCursorEvents` level window. Rust tidak punya logika drag — ia hanya menyediakan flag `visible`.
- `src/resize/resize.pointer-capture.ts` adalah registry suppressor; jangan tambah cabang if/else renderer di situ. Kelas `body.noc-resizing` implementasi iframe saja. Catat: `pane.webview-renderer.ts` mendaftarkan suppressor-nya sebagai efek samping saat modul diimpor.
- `src/pane/pane.renderer.ts` sengaja menerapkan `place`/`release`/`setCursorCapture` ke **kedua** renderer (no-op bagi yang tak melayani pane) agar layer geometri tak perlu tahu renderer mana yang dipakai.

**4. Handshake sidecar lewat stdout.** Rust men-spawn server dengan `NOC_PORT=0`, mem-parse baris `noc-ready <url>` untuk tahu port nyata, dan baru itu membuka window wall. Prefix terduplikasi sebagai literal di `src/server/server.ready.ts` dan `src-tauri/src/sidecar.rs` — **ubah keduanya bersama.** Server tidak pernah pindah port diam-diam: port terpakai = exit 1. Sidecar mengawasi `NOC_PARENT_PID` (signal 0, poll 1 s) agar tak jadi orphan; jangan andalkan parent membunuh child — force-quit tak pernah sampai ke kode itu.

**5. Permukaan frontend→native hanya 3 `invoke`:** `pane_webview_show|place|close`, lewat `src/native/native.bridge.ts` saja. Tidak ada `emit`/`listen` dua arah — jangan tambahkan tanpa alasan kuat. Tiap command baru butuh entri di `src-tauri/capabilities/default.json` (wall page adalah origin remote `http://127.0.0.1:*`).

## Konvensi kode

- Nama file `[domain].[layer].ts(x)` tanpa kecuali; folder = domain. **Tanpa barrel `index.ts`, tanpa `utils/`, tanpa `helpers/`.**
- Impor dengan ekstensi file eksplisit (`./pane.store.ts`) — `allowImportingTsExtensions` + `verbatimModuleSyntax` aktif, jadi `import type` wajib untuk tipe.
- tsconfig strict penuh + `noUncheckedIndexedAccess` + `noFallthroughCasesInSwitch` + `noImplicitOverride`. TypeScript 7 (`^7.0.2`).
- Pisah tegas fungsi murni ↔ efek: `layout.tree`, `layout.remove`, `resize.session`, `pane.load-state`, `embed.classifier`, `persist.snapshot` nol DOM/React/store. `pane.store.ts` hanya menyimpan state dan mengurutkan efek.
- Pola port yang bisa di-inject: `createX(deps)` + singleton terpisah di file yang sama — `PaneRenderer`, `NativePaneBridge`, `WallPersistPort`, `PanePointerSuppressor`, `RectReader`, `GeometryRegistry`. Test membangun miliknya sendiri; jangan mem-mock modul.
- Error memakai result-type (`{ok:true,...} | {ok:false, reason}`) bukan throw; throw hanya untuk input user/operator yang salah (`readConfig`, `splitPane` pada pane docked).
- Tiap file dibuka docblock **"kenapa"**, bukan "apa". Pertahankan pola itu — komentar-komentar itulah yang mencegah invariant di atas "dibetulkan".
- `data-testid` di tiap elemen penting: `slot-`, `split-`, `splitter-`, `pane-host-`, `pane-webview-`, `pane-refused-`, `pane-controls-`, `pane-split-row-`/`pane-split-column-`, `pane-dock-`, `pane-close-`, `pane-strategy-`, `pane-dock-strip`, `dock-entry-`/`dock-restore-`/`dock-close-`.

## Jebakan test

- `bunfig.toml` mem-preload `tests/setup/happy-dom.ts`.
- **happy-dom mengukur semua elemen NOL.** Test apa pun yang menyentuh geometri atau aritmetika drag wajib `stubRect` dari `tests/fixtures/dom-rect.ts`. Geometri nyata hanya bisa diverifikasi di browser/app sungguhan — jangan klaim terbukti karena test hijau.
- Loading iframe dimatikan; `console.error` happy-dom soal itu difilter di setup. Pane hanya bisa diperiksa dari atribut `src`, bukan dari fetch.
- `useWallStore` singleton modul: reset seluruh store dan settle probe yang menggantung antar test (`tests/fixtures/wall-store.ts`). Begitu juga set suppressor di `resize.pointer-capture` yang hidup di level modul.
- Fixture header di `tests/fixtures/embed-headers.ts`; jangan tulis test yang menembak jaringan. `GET /api/self-test` ada supaya setup manual pun tak perlu internet.
- Tanpa test: Rust, `scripts/`, dan sebagian besar `src/server/*`.

## Env & keamanan

Semua env dibaca **hanya** di `src/config/config.env.ts` — jangan baca `process.env` di tempat lain. `NOC_HOST` (127.0.0.1) · `NOC_PORT` (7788, `0` = ephemeral) · `NOC_DATA_DIR` (.noc-data) · `NOC_DB_FILE` (noc.sqlite) · `NOC_LOG_LEVEL` (info — divalidasi tapi belum dipakai di mana pun) · `NOC_PARENT_PID`. Shell Rust meneruskan `NOC_HOST`, `NOC_PORT`, `NOC_PARENT_PID`, plus `NOC_DATA_DIR`/`NOC_DB_FILE`/`NOC_LOG_LEVEL` bila di-set (`sidecar_env()` di `src-tauri/src/sidecar.rs`).

Loopback bukan kebetulan: `/api/embeddability` membuat server mem-fetch URL pilihan client (SSRF bila terbuka) dan layout tersimpan berisi nama dashboard internal. Bind ke `0.0.0.0` hanya atas permintaan eksplisit operator. Path database di-resolve terhadap base dir eksplisit, bukan `process.cwd()`, dan tidak boleh berada di dalam executable (`bun build --compile` menerima tulisan lalu membuangnya saat proses keluar).

## Yang belum ada

- **M5 sudah dibangun tapi BELUM pernah dilihat di layar.** `pane.controls.tsx` dan `pane.dock.tsx` memanggil `splitPane`/`dockPane`/`deletePane`/`undockPane` dari UI, dan test-nya hijau — tapi hijau di happy-dom tidak membuktikan apa pun soal geometri atau tata letak (lihat "Jebakan test"). Jangan tulis "M5 beres"; yang bisa dikatakan hanya "ada dan ter-unit-test".
- **Switch renderer per pane (`<select>` di `pane.urlbar.tsx`) juga belum dilihat di layar.** Status yang sama: `setPaneStrategy`, `rendererChange`, skip probe, dan teks refusal bercabang semuanya ter-test, nol bukti visual.
- **Restore dari dock belum bisa memilih tujuan.** `undockPane` butuh pane host + arah, dan UI belum punya konsep "pane terpilih", jadi `pane.dock.tsx` selalu restore di sebelah `listTreePaneIds(tree)[0]` dengan arah `"row"`. Penyederhanaan sengaja, bukan bug — perbaikannya butuh selected-pane atau drop target dulu.
- Saved views: rute `/view/:viewId` dan tabel sudah ada, store view belum.
