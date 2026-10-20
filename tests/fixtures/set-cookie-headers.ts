// test-only
//
// Hand-written `Set-Cookie` headers, one entry per header exactly as
// `Headers.getSetCookie()` hands them over. Nothing here was recorded from a
// real response and nothing here is a real cookie value: a cookie value is a
// credential, so every value below is the literal `x`. What is under test is
// the attributes, which is all the classifier ever reads.

export const SAFE_IN_FRAME = ["sid=x; Path=/; SameSite=None; Secure"];

export const NONE_WITHOUT_SECURE = ["sid=x; Path=/; SameSite=None"];

export const LAX = ["sid=x; Path=/; SameSite=Lax"];

export const STRICT = ["sid=x; Path=/; SameSite=Strict"];

/** The common case, and the one that bites: no `SameSite` at all. */
export const NO_SAMESITE = ["sid=x; Path=/; HttpOnly"];

/**
 * The comma trap. `Expires` carries one inside a single attribute, so a parser
 * that split the list on commas would read this as two broken cookies and lose
 * the `SameSite` that disqualifies it.
 */
export const EXPIRES_WITH_COMMA = [
  "sid=x; Expires=Wed, 09 Jun 2027 10:18:14 GMT; Path=/; SameSite=Lax",
];

/** One cookie a frame sends and one it drops, from the same response. */
export const MIXED = [
  "csrf=x; SameSite=None; Secure",
  "sid=x; Path=/; HttpOnly",
];

/** Lowercase attributes and odd spacing are legal and mean the same thing. */
export const LOWERCASE_ATTRIBUTES = ["sid=x;path=/;samesite=none;secure"];
