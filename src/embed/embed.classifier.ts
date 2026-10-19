/**
 * Decides whether a target may be framed, from its response headers.
 *
 * This is classification, not circumvention: nothing here strips or alters a
 * header. It exists because the embedder cannot detect refusal from the client
 * side — a frame blocked by `X-Frame-Options` still fires `load` in Chromium,
 * and its document is not readable, so there is nothing to inspect.
 */

export type EmbedVerdict = "allowed" | "refused" | "unknown";

export type EmbedHeaders = {
  xFrameOptions?: string | undefined;
  contentSecurityPolicy?: string | undefined;
};

export type EmbedDecision = {
  verdict: EmbedVerdict;
  /** Which header drove the decision, for display in the pane's refusal state. */
  reason: string;
};

function frameAncestors(csp: string | undefined): string[] | null {
  if (csp === undefined) return null;
  for (const directive of csp.split(";")) {
    const parts = directive.trim().split(/\s+/);
    const name = parts[0]?.toLowerCase();
    if (name === "frame-ancestors") {
      return parts.slice(1).map((source) => source.toLowerCase());
    }
  }
  return null;
}

function sourceAllowsOrigin(source: string, embedderOrigin: string): boolean {
  if (source === "*") return true;
  if (source === "'self'" || source === "'none'") return false;
  if (source.endsWith(":") && embedderOrigin.startsWith(source)) return true;

  let embedder: URL;
  try {
    embedder = new URL(embedderOrigin);
  } catch {
    return false;
  }
  const candidate = source.includes("://") ? source : `https://${source}`;
  try {
    const allowed = new URL(candidate);
    const hostMatches = allowed.hostname.startsWith("*.")
      ? embedder.hostname.endsWith(allowed.hostname.slice(1))
      : allowed.hostname === embedder.hostname;
    const portMatches = allowed.port === "" || allowed.port === embedder.port;
    return hostMatches && portMatches;
  } catch {
    return false;
  }
}

/**
 * CSP `frame-ancestors` takes precedence over `X-Frame-Options` when both are
 * present, which is what browsers do.
 */
export function classifyEmbeddability(
  headers: EmbedHeaders,
  embedderOrigin: string,
): EmbedDecision {
  const ancestors = frameAncestors(headers.contentSecurityPolicy);
  if (ancestors !== null) {
    if (ancestors.length === 0) {
      return {
        verdict: "unknown",
        reason: "content-security-policy: frame-ancestors is present but empty",
      };
    }
    if (ancestors.includes("'none'")) {
      return {
        verdict: "refused",
        reason: "content-security-policy: frame-ancestors 'none'",
      };
    }
    const permitted = ancestors.some((source) =>
      sourceAllowsOrigin(source, embedderOrigin),
    );
    return permitted
      ? {
          verdict: "allowed",
          reason: `content-security-policy: frame-ancestors permits ${embedderOrigin}`,
        }
      : {
          verdict: "refused",
          reason: `content-security-policy: frame-ancestors does not list ${embedderOrigin}`,
        };
  }

  const xfo = headers.xFrameOptions?.trim().toLowerCase();
  if (xfo === undefined || xfo === "") {
    return { verdict: "allowed", reason: "no framing headers present" };
  }
  if (xfo === "deny") {
    return { verdict: "refused", reason: "x-frame-options: deny" };
  }
  if (xfo === "sameorigin") {
    return { verdict: "refused", reason: "x-frame-options: sameorigin" };
  }
  return {
    verdict: "unknown",
    reason: `x-frame-options: unrecognised value "${xfo}"`,
  };
}
