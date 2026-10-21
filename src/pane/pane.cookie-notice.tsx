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
 * Why this shape, and not an overlay. The page underneath may still be worth
 * reading, so this sits at the foot of the body's single grid cell as a sibling
 * of the frame rather than across it, and takes no pointer events, so the page
 * stays clickable where it shows through. Deliberately not dismissible — a
 * dismissal is per-pane state, and nothing has yet shown that the line is in
 * the way.
 *
 * One wall can see it: the cookies it warns about travel again as soon as the
 * site is served from a sibling subdomain of the wall's own host, and on such a
 * wall `/api/embeddability` answers without a verdict for this to carry. So it
 * speaks for a wall opened at `127.0.0.1` — which is what its advice points
 * away from.
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
};

export function PaneCookieNotice({ paneId, decision }: PaneCookieNoticeProps) {
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
      cross-site, so the browser keeps these cookies out of it: {named}. Open
      this wall at its own hostname, where the site is served same-site and
      these cookies travel, or have the site send SameSite=None; Secure;
      Partitioned.
    </div>
  );
}
