// test-only
//
// Framing headers recorded on 2026-10-19 with `curl -sIL` and confirmed against
// the server's own GET probe. These are real responses, not invented values, so
// the classifier is tested against what the wall will actually meet. Re-record
// if a target changes its policy — some targets answer HEAD and GET differently.

export type RecordedTarget = {
  url: string;
  xFrameOptions?: string;
  contentSecurityPolicy?: string;
  expected: "allowed" | "refused";
};

export const EMBEDDABLE_TARGETS: RecordedTarget[] = [
  { url: "https://example.com", expected: "allowed" },
  { url: "https://info.cern.ch", expected: "allowed" },
  { url: "https://www.wikipedia.org", expected: "allowed" },
];

export const REFUSING_TARGETS: RecordedTarget[] = [
  {
    url: "https://github.com",
    xFrameOptions: "deny",
    contentSecurityPolicy: "frame-ancestors 'none'",
    expected: "refused",
  },
  {
    // Grafana denies framing by default — the exact case an internal dashboard
    // has to be reconfigured for before it can go on the wall. It answers HEAD
    // with x-frame-options only, and GET with the stricter CSP as well.
    url: "https://play.grafana.org",
    xFrameOptions: "deny",
    contentSecurityPolicy: "frame-ancestors 'none'",
    expected: "refused",
  },
  {
    url: "https://status.openai.com",
    xFrameOptions: "SAMEORIGIN",
    contentSecurityPolicy: "frame-ancestors 'self'",
    expected: "refused",
  },
  {
    url: "https://www.google.com",
    xFrameOptions: "SAMEORIGIN",
    expected: "refused",
  },
  {
    url: "https://x.com",
    xFrameOptions: "SAMEORIGIN",
    contentSecurityPolicy:
      "frame-ancestors 'self' https://x.com https://x.com:443 https://twitter.com https://twitter.com:443",
    expected: "refused",
  },
  {
    url: "https://www.youtube.com",
    xFrameOptions: "SAMEORIGIN",
    expected: "refused",
  },
];
