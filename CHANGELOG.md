# Changelog

## [0.1.0] - 2026-10-19

### Added

- A single pane that loads a URL, with a URL bar you can hide and show, a
  reload button, and input validation that rejects anything other than `http`
  and `https`.
- An explicit refusal state: when a site declines to be framed, the pane says
  which header caused it instead of showing an empty box.
- Server-side embeddability probe at `/api/embeddability`, and a built-in
  always-framable page at `/api/self-test` for setup and smoke checks.
- Pane tree engine with split, delete, resize, dock and undock, plus structural
  invariants checked against 8,000 randomly generated operation sequences.
- Versioned layout serialization, so stored layouts can be migrated later.
- Configuration through `NOC_HOST`, `NOC_PORT`, `NOC_DATA_DIR` and
  `NOC_LOG_LEVEL`, defaulting to loopback.
- `bun run build:binary` produces a standalone executable that serves the
  frontend from inside itself.
