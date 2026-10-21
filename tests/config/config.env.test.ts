import { describe, expect, test } from "bun:test";

import { readConfig } from "../../src/config/config.env.ts";

describe("readConfig defaults", () => {
  test("binds to loopback, not every interface", () => {
    // Widening this would put the saved layout and the internal URL list on the
    // local network, so it must stay a deliberate choice by the operator.
    expect(readConfig({}).host).toBe("127.0.0.1");
  });

  test("fills in port, data dir and log level", () => {
    expect(readConfig({})).toEqual({
      host: "127.0.0.1",
      port: 7788,
      dataDir: ".noc-data",
      dbFile: "noc.sqlite",
      logLevel: "info",
    });
  });

  test("treats an empty string as absent", () => {
    expect(readConfig({ NOC_PORT: "", NOC_HOST: "", NOC_LOG_LEVEL: "" })).toEqual(
      readConfig({}),
    );
  });
});

describe("readConfig overrides", () => {
  test("accepts every supplied value", () => {
    expect(
      readConfig({
        NOC_HOST: "0.0.0.0",
        NOC_PORT: "9000",
        NOC_DATA_DIR: "/var/lib/noc",
        NOC_DB_FILE: "wall.sqlite",
        NOC_LOG_LEVEL: "debug",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 9000,
      dataDir: "/var/lib/noc",
      dbFile: "wall.sqlite",
      logLevel: "debug",
    });
  });

  test("accepts port 0, which asks the OS for a free one", () => {
    // An ephemeral port is the way to run a second wall alongside one that
    // already holds 7788; the real port is printed on the listening line.
    expect(readConfig({ NOC_PORT: "0" }).port).toBe(0);
  });
});

describe("readConfig rejects bad input with a message naming the variable", () => {
  test.each([
    ["notanumber"],
    ["65536"],
    ["-1"],
    ["80.5"],
  ])("NOC_PORT=%p", (value) => {
    expect(() => readConfig({ NOC_PORT: value })).toThrow(/NOC_PORT/);
  });

  test("an unknown log level", () => {
    expect(() => readConfig({ NOC_LOG_LEVEL: "shout" })).toThrow(
      /NOC_LOG_LEVEL must be one of/,
    );
  });
});
