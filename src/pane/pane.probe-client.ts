/** Client side of the server's embeddability probe. */

import type { EmbedVerdict } from "../embed/embed.classifier.ts";
import { EMBEDDABILITY_PATH } from "../server/server.routes.ts";

export type ProbeResponse = { verdict: EmbedVerdict; reason: string };

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
  return { verdict: body.verdict, reason: body.reason ?? "" };
}
