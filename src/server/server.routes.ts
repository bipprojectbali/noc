/** HTTP handlers shared by the dev server and the compiled binary. */

import { probeEmbeddability } from "./embed.probe.ts";

export const EMBEDDABILITY_PATH = "/api/embeddability";

/** A page the wall can always frame, so tests and setup never depend on the network. */
export const SELF_TEST_PATH = "/api/self-test";

const SELF_TEST_BODY = `<!doctype html>
<meta charset="utf-8">
<title>NOC self test</title>
<body style="margin:0;display:grid;place-items:center;height:100vh;font:600 14px system-ui;background:#0f1115;color:#7ee787">
pane renderer OK
</body>`;

export function handleSelfTest(): Response {
  return new Response(SELF_TEST_BODY, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function handleEmbeddability(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get("url");
  if (target === null || target === "") {
    return Response.json({ error: "query parameter 'url' is required" }, { status: 400 });
  }

  const embedderOrigin = new URL(request.url).origin;
  const result = await probeEmbeddability(target, embedderOrigin);

  if (!result.ok) {
    return Response.json({ verdict: "unknown", reason: result.reason }, { status: 200 });
  }
  return Response.json({
    verdict: result.decision.verdict,
    reason: result.decision.reason,
    status: result.status,
  });
}
