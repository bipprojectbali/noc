/**
 * Tells the user when this wall cannot hold a session, instead of letting him
 * watch panes bounce back to a login form with no explanation.
 *
 * A wall opened on `127.0.0.1` or bare `localhost` is on a host that cannot be
 * same-site with anything it frames, so every pane's session cookie is dropped
 * on the next request (`proxy.label.ts`). That is unfixable from the page, and
 * invisible: the pane simply shows the login screen again. One line naming the
 * host that does work costs nothing and saves the hour it otherwise takes to
 * work out that the wall's own address was the problem.
 *
 * Silent in the native shell. There the wall is loaded over loopback by design
 * — the handshake announces that address — and the answer for a pane that keeps
 * bouncing is the native renderer, which is a top-level document and never had
 * the problem. Pointing at a browser host there would be wrong advice.
 *
 * Rendered above the wall, never over it: a native webview ignores CSS
 * clipping, so a message drawn on a pane would be hidden behind that pane.
 */

import { isNativeHost } from "../native/native.bridge.ts";
import { WALL_PROXY_HOSTNAME, wallProxyBase } from "./proxy.label.ts";

export function ProxyHostNotice() {
  if (isNativeHost()) return null;
  if (wallProxyBase(window.location.hostname) !== null) return null;

  const port = window.location.port === "" ? "" : `:${window.location.port}`;
  const target = `http://${WALL_PROXY_HOSTNAME}${port}/`;

  return (
    <p className="noc-notice" role="status" data-testid="proxy-host-notice">
      Panes on <code>{window.location.host}</code> cannot keep a login session:
      their cookies count as cross-site here. Open <a href={target}>{target}</a>{" "}
      instead — same wall, same layout, sessions that survive.
    </p>
  );
}
