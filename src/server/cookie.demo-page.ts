/**
 * The one page in this app whose job is to be looked at rather than used.
 *
 * It answers a question the test suite structurally cannot: does a cookie
 * without `SameSite` really get withheld inside a pane? Everything in `tests/`
 * runs in happy-dom, which has no cookie jar and no concept of a site, so the
 * wall's cookie warning has never been checked against a browser even once.
 * This page checks it, in about ten seconds, with no internet and no login.
 *
 * **The trick that makes it work on loopback.** `SameSite` compares the
 * registrable domain plus scheme of the request against that of the *top-level*
 * document, and the port is explicitly not part of that comparison. So framing
 * `127.0.0.1` inside `127.0.0.1` proves nothing however the ports differ — it
 * is same-site, and every variant comes back. But `localhost` is a hostname
 * with no registrable domain while `127.0.0.1` is an IP address, so each is its
 * own site and the pair is genuinely cross-site. One server, one process, pure
 * loopback, and still the exact relationship a real framed dashboard has with
 * the wall. That is why this page measures and loudly reports which host it was
 * reached on instead of assuming the user picked the right one.
 *
 * **Why the client script does the measuring.** The two checks have to be made
 * from inside the frame, by the frame's own fetches, because that is the
 * context whose cookies are in question. A server-rendered table could only
 * report the navigation request, which follows different rules.
 *
 * The client script is plain ES5-style concatenation on purpose: no template
 * literals, so nothing in it collides with the TypeScript template literal it
 * is embedded in, and no build step is involved in a page whose whole value is
 * being obviously, inspectably literal.
 */

export type CookieDemoPagePaths = {
  /** Absolute paths, never relative: `/api/cookie-demo` has no trailing
   * slash, so a relative "set" would resolve to `/api/set`. */
  readonly set: string;
  readonly read: string;
};

const STYLE = `
:root { color-scheme: dark }
* { box-sizing: border-box }
body { margin: 0; padding: 24px; background: #0f1115; color: #e6edf3;
  font: 14px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace }
h1 { font-size: 15px; margin: 0 0 4px; letter-spacing: .02em }
p { margin: 0 0 14px; color: #8b949e; max-width: 70ch }
#verdict { padding: 10px 12px; border-radius: 6px; margin: 0 0 16px;
  border: 1px solid #30363d; background: #161b22; white-space: pre-wrap }
#verdict.good { border-color: #2ea043; background: #0d2a16 }
#verdict.warn { border-color: #d29922; background: #2b2003 }
#verdict.bad { border-color: #f85149; background: #2d0f0f }
table { border-collapse: collapse; width: 100%; max-width: 1100px }
th, td { border: 1px solid #30363d; padding: 7px 9px; text-align: left;
  vertical-align: top }
th { background: #161b22; font-weight: 600; color: #8b949e }
td.flag { text-align: center; font-size: 16px; white-space: nowrap }
.yes { color: #3fb950 } .no { color: #f85149 }
code { color: #79c0ff }
small { color: #6e7681; display: block; margin-top: 3px; font-size: 12px;
  font-family: ui-sans-serif, system-ui, sans-serif; line-height: 1.45 }
button { font: inherit; margin: 16px 0 0; padding: 7px 14px; cursor: pointer;
  background: #21262d; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px }
#hosts { margin-top: 20px; max-width: 70ch }
`;

const SCRIPT = `
function jarNames() {
  var found = {};
  // document.cookie throws, or silently reads empty, when a frame's storage is
  // blocked. Either way "not in the jar" is the honest reading.
  try {
    (document.cookie || "").split(";").forEach(function (pair) {
      var at = pair.indexOf("=");
      if (at !== -1) found[pair.slice(0, at).trim()] = true;
    });
  } catch (error) { /* blocked: leave it empty */ }
  return found;
}

function flag(cell, ok) {
  cell.className = "flag " + (ok ? "yes" : "no");
  cell.textContent = ok ? "\\u2713 ya" : "\\u2717 tidak";
}

function setVerdict(tone, text) {
  var box = document.getElementById("verdict");
  box.className = tone;
  box.textContent = text;
}

function describeContext() {
  var framed = window.self !== window.top;
  var topReadable = true;
  // A cross-origin top-level document makes this throw, and that throw is the
  // only signal available: a frame can never read the host that embeds it.
  try { void window.top.location.hostname; } catch (error) { topReadable = false; }

  if (!framed) {
    setVerdict("good",
      "TOP-LEVEL \\u2014 ini baseline, bukan buktinya.\\n" +
      "Halaman ini adalah dokumen teratas, jadi setiap request darinya same-site " +
      "menurut definisi. Kelima varian HARUS kembali. Kalau ada yang tidak, " +
      "penyebabnya bukan SameSite \\u2014 periksa pemblokiran cookie di browser.");
    return "top-level";
  }
  if (topReadable) {
    setVerdict("bad",
      "DI DALAM FRAME, TAPI SAME-SITE \\u2014 demo ini tidak membuktikan apa pun di sini.\\n" +
      "Host halaman ini sama dengan host halaman wall, dan port tidak dihitung " +
      "oleh SameSite. Jadi kelima varian akan kembali dan itu bukan kabar baik, " +
      "cuma perbandingan yang salah. Pakai host yang berbeda \\u2014 lihat daftar " +
      "URL di bawah tabel.");
    return "same-site frame";
  }
  setVerdict("warn",
    "DI DALAM FRAME, CROSS-SITE \\u2014 ini kondisi pane sungguhan.\\n" +
    "Dokumen teratas ada di site yang berbeda, persis hubungan yang dimiliki " +
    "dashboard ber-iframe dengan halaman wall. Yang ditandai \\u2717 di kolom " +
    "terakhir adalah cookie yang akan hilang saat login di dalam pane.");
  return "cross-site frame";
}

function renderHosts() {
  var here = location.protocol + "//" + location.host + location.pathname;
  var other = location.hostname === "localhost"
    ? location.protocol + "//127.0.0.1:" + location.port + location.pathname
    : location.protocol + "//localhost:" + location.port + location.pathname;
  document.getElementById("hosts").innerHTML =
    "<small><b>Halaman ini:</b> <code>" + here + "</code>" +
    "<br><b>Host pasangannya:</b> <code>" + other + "</code>" +
    "<br><br>localhost dan 127.0.0.1 adalah dua <i>site</i> berbeda bagi browser " +
    "(satu hostname tanpa registrable domain, satu alamat IP), padahal keduanya " +
    "dilayani proses yang sama. Itulah yang membuat demo ini cross-site tanpa " +
    "internet. Supaya ada bedanya: buka satu URL di tab, lalu masukkan URL " +
    "<b>yang host-nya berbeda</b> sebagai situs sebuah pane.</small>";
}

async function run() {
  var context = describeContext();
  var body = document.getElementById("rows");
  body.textContent = "";

  var attempted;
  try {
    var setResponse = await fetch(SET_PATH, { credentials: "same-origin", cache: "no-store" });
    attempted = (await setResponse.json()).attempted;
  } catch (error) {
    setVerdict("bad", "Gagal memanggil endpoint set: " + error);
    return;
  }

  // Read the jar between the two calls: a cookie the browser refused outright
  // never lands here, which is a different failure from one that lands and is
  // then withheld. That difference is the lesson.
  var jar = jarNames();

  var sentBack;
  try {
    var readResponse = await fetch(READ_PATH, { credentials: "same-origin", cache: "no-store" });
    sentBack = (await readResponse.json()).sentBack;
  } catch (error) {
    setVerdict("bad", "Gagal memanggil endpoint read: " + error);
    return;
  }

  attempted.forEach(function (variant) {
    var row = body.insertRow();
    var name = row.insertCell();
    name.innerHTML = "<code>" + variant.cookieName + "</code><small>" +
      variant.expectation + "</small>";
    row.insertCell().innerHTML = "<code>" +
      (variant.attributes === "" ? "(tidak ada)" : variant.attributes) + "</code>";
    flag(row.insertCell(), jar[variant.cookieName] === true);
    flag(row.insertCell(), sentBack.indexOf(variant.id) !== -1);
  });

  document.getElementById("counts").textContent =
    context + " \\u2014 " + sentBack.length + " dari " + attempted.length +
    " varian dikirim balik oleh browser.";
}

document.getElementById("rerun").addEventListener("click", function () { void run(); });
renderHosts();
void run();
`;

export function cookieDemoPage(paths: CookieDemoPagePaths): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>NOC cookie SameSite demo</title>
<style>${STYLE}</style>
<h1>Cookie SameSite di dalam pane — bukti, bukan klaim</h1>
<p>Server menyetel lima varian cookie dalam satu respons, lalu satu request
berikutnya melaporkan varian mana yang benar-benar dikirim balik browser.
Selisih kedua kolom terakhir itulah penyebab login di dalam pane terlihat
gagal. Semua nilai cookie di sini dummy dan kedaluwarsa dalam 10 menit.</p>
<div id="verdict">Mengukur…</div>
<table>
  <thead><tr>
    <th style="width:38%">Varian</th>
    <th style="width:22%">Atribut <code>Set-Cookie</code></th>
    <th style="width:20%">Masuk jar?<br><small>document.cookie</small></th>
    <th style="width:20%">Dikirim balik?<br><small>header Cookie</small></th>
  </tr></thead>
  <tbody id="rows"></tbody>
</table>
<p id="counts" style="margin-top:12px"></p>
<button id="rerun" type="button">Jalankan ulang</button>
<div id="hosts"></div>
<script>
var SET_PATH = ${JSON.stringify(paths.set)};
var READ_PATH = ${JSON.stringify(paths.read)};
${SCRIPT}
</script>`;
}
