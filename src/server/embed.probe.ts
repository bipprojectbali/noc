/**
 * Reads a target's framing headers server-side.
 *
 * Note for the operator: this makes the server fetch an address the client
 * supplies. That is deliberate — internal dashboards are the point — and it is
 * why the server binds to loopback by default. Exposing it on a wider interface
 * turns this endpoint into a request relay for whoever can reach it.
 */

import {
  classifyEmbeddability,
  type EmbedDecision,
} from "../embed/embed.classifier.ts";
import {
  classifyFrameCookies,
  type FrameCookieDecision,
} from "../embed/embed.cookies.ts";

export const PROBE_TIMEOUT_MS = 8000;

export type ProbeResult =
  | {
      ok: true;
      decision: EmbedDecision;
      /**
       * Whether the session this response hands out survives being framed.
       * Read off the response already in hand — this adds no request, and it
       * never changes `decision`: a site whose cookies will be dropped is
       * still a site the wall shows.
       */
      cookies: FrameCookieDecision;
      status: number;
    }
  | { ok: false; reason: string };

export async function probeEmbeddability(
  target: string,
  embedderOrigin: string,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return { ok: false, reason: "target is not a valid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: `unsupported protocol "${parsed.protocol}"` };
  }

  try {
    const response = await fetch(parsed, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Headers are all this needs; dropping the body keeps a large page from
    // being pulled through the server on every probe.
    await response.body?.cancel();

    return {
      ok: true,
      status: response.status,
      // One header per entry, which is what keeps a comma inside an `Expires`
      // from being read as the boundary between two cookies.
      cookies: classifyFrameCookies(response.headers.getSetCookie()),
      decision: classifyEmbeddability(
        {
          xFrameOptions: response.headers.get("x-frame-options") ?? undefined,
          contentSecurityPolicy:
            response.headers.get("content-security-policy") ?? undefined,
        },
        embedderOrigin,
      ),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `probe failed: ${reason}` };
  }
}
