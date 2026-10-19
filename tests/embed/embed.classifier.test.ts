import { describe, expect, test } from "bun:test";

import { classifyEmbeddability } from "../../src/embed/embed.classifier.ts";
import {
  EMBEDDABLE_TARGETS,
  REFUSING_TARGETS,
} from "../fixtures/embed-headers.ts";

const EMBEDDER_ORIGIN = "http://127.0.0.1:7788";

describe("classifyEmbeddability against recorded real-world headers", () => {
  for (const target of [...EMBEDDABLE_TARGETS, ...REFUSING_TARGETS]) {
    test(`${target.url} is ${target.expected}`, () => {
      const decision = classifyEmbeddability(
        {
          xFrameOptions: target.xFrameOptions,
          contentSecurityPolicy: target.contentSecurityPolicy,
        },
        EMBEDDER_ORIGIN,
      );
      expect(decision.verdict).toBe(target.expected);
      expect(decision.reason).not.toBe("");
    });
  }
});

describe("classifyEmbeddability precedence and edge cases", () => {
  test("frame-ancestors wins over a permissive x-frame-options", () => {
    const decision = classifyEmbeddability(
      {
        xFrameOptions: "allowall",
        contentSecurityPolicy: "default-src 'self'; frame-ancestors 'none'",
      },
      EMBEDDER_ORIGIN,
    );
    expect(decision.verdict).toBe("refused");
    expect(decision.reason).toContain("frame-ancestors 'none'");
  });

  test("allows the embedder when frame-ancestors lists its origin", () => {
    const decision = classifyEmbeddability(
      { contentSecurityPolicy: "frame-ancestors http://127.0.0.1:7788" },
      EMBEDDER_ORIGIN,
    );
    expect(decision.verdict).toBe("allowed");
  });

  test("rejects a listed host when the port differs", () => {
    const decision = classifyEmbeddability(
      { contentSecurityPolicy: "frame-ancestors http://127.0.0.1:9999" },
      EMBEDDER_ORIGIN,
    );
    expect(decision.verdict).toBe("refused");
  });

  test("honours a wildcard subdomain source", () => {
    const decision = classifyEmbeddability(
      { contentSecurityPolicy: "frame-ancestors https://*.internal.example" },
      "https://grafana.internal.example",
    );
    expect(decision.verdict).toBe("allowed");
  });

  test("honours a bare wildcard", () => {
    const decision = classifyEmbeddability(
      { contentSecurityPolicy: "frame-ancestors *" },
      EMBEDDER_ORIGIN,
    );
    expect(decision.verdict).toBe("allowed");
  });

  test("treats no framing headers as allowed", () => {
    expect(classifyEmbeddability({}, EMBEDDER_ORIGIN)).toEqual({
      verdict: "allowed",
      reason: "no framing headers present",
    });
  });

  test("reports unknown rather than guessing on an unrecognised x-frame-options", () => {
    const decision = classifyEmbeddability(
      { xFrameOptions: "allow-from https://example.com" },
      EMBEDDER_ORIGIN,
    );
    expect(decision.verdict).toBe("unknown");
  });

  test("reports unknown when frame-ancestors is present but empty", () => {
    const decision = classifyEmbeddability(
      { contentSecurityPolicy: "frame-ancestors" },
      EMBEDDER_ORIGIN,
    );
    expect(decision.verdict).toBe("unknown");
  });
});
