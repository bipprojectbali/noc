/** Client side of the server's embeddability probe. */

import type { EmbedVerdict } from "../embed/embed.classifier.ts";
import type { FrameCookieDecision } from "../embed/embed.cookies.ts";
import { EMBEDDABILITY_PATH } from "../server/server.routes.ts";

export type ProbeResponse = {
  verdict: EmbedVerdict;
  reason: string;
  /**
   * Whether the target's session cookies survive a frame. Defaulted rather than
   * required: a probe that failed sends no verdict about cookies either, and an
   * older wall page talking to a newer server is not worth a second code path.
   */
  cookies: FrameCookieDecision;
};

export async function fetchEmbeddability(url: string): Promise<ProbeResponse> {
  const response = await fetch(
    `${EMBEDDABILITY_PATH}?url=${encodeURIComponent(url)}`,
  );
  if (!response.ok) {
    throw new Error(`Embeddability probe returned ${response.status}`);
  }
  const body = (await response.json()) as Partial<ProbeResponse>;
  if (body.verdict === undefined) {
    throw new Error("Embeddability probe returned no verdict");
  }
  return {
    verdict: body.verdict,
    reason: body.reason ?? "",
    cookies: body.cookies ?? { verdict: "unknown" },
  };
}
