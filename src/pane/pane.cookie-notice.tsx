/**
 * Says why a login inside a framed pane will not stick.
 *
 * Why it exists: the failure it describes is invisible and reads as a bug in
 * this app. The user signs in, the site answers with a session cookie the
 * browser accepts and then refuses to attach to a cross-site frame, the next
 * request arrives without it, and the page comes back as the login form. See
 * `embed.cookies.ts` for the rule itself. The wall already fetches the target's
 * headers to classify framing, so it can know this before the attempt — and
 * saying nothing is what turns a browser rule into "the app is broken".
 *
 * Why this shape, and not an overlay. It only ever renders for an iframe pane,
 * because a native webview is a top-level document where `SameSite` does not
 * apply at all — so the case invariant 3 guards against (a native view painting
 * above the web layer) cannot arise here. What is left is the page itself,
 * which may still be worth reading: this sits at the foot of the body's single
 * grid cell as a sibling of the frame rather than across it, and takes no
 * pointer events, so the page underneath stays clickable where it shows
 * through. Deliberately not dismissible — a dismissal is per-pane state, and
 * nothing has yet shown that the line is in the way.
 */

import {
  FRAME_COOKIE_PROBLEM_TEXT,
  type FrameCookieDecision,
} from "../embed/embed.cookies.ts";
import type { PaneId } from "../layout/layout.types.ts";

export type PaneCookieNoticeProps = {
  paneId: PaneId;
  /** The verdict carried by the pane's active site, if its probe has settled. */
  decision: FrameCookieDecision | undefined;
  /** In a browser the way out is the desktop app; in the shell it is the menu. */
  nativeHost: boolean;
};

export function PaneCookieNotice({
  paneId,
  decision,
  nativeHost,
}: PaneCookieNoticeProps) {
  // "unknown" is the common case and must stay silent: a login page often sets
  // no cookie on the GET this verdict came from, and guessing would cry wolf.
  if (decision === undefined || decision.verdict !== "blocked") return null;

  const named = decision.blocked
    .map((cookie) => `${cookie.name} (${FRAME_COOKIE_PROBLEM_TEXT[cookie.problem]})`)
    .join("; ");

  return (
    <div
      className="noc-pane__cookie-note"
      role="status"
      data-testid={`pane-cookie-warning-${paneId}`}
    >
      <strong>Signing in here will not stick.</strong> A framed page is
      cross-site, so the browser keeps these cookies out of it: {named}.{" "}
      {nativeHost
        ? "Set this pane's renderer to Webview in its ⋮ menu — a native webview is a top-level document — or have the site send SameSite=None; Secure; Partitioned."
        : "Open this wall in the desktop app and set the pane's renderer to Webview, or have the site send SameSite=None; Secure; Partitioned."}
    </div>
  );
}
