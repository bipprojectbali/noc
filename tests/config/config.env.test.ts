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
      parentPid: null,
    });
  });

  test("watches no parent unless told to", () => {
    // Only a sidecar has a parent worth outliving nothing; a dev server is
    // stopped by whoever started it.
    expect(readConfig({}).parentPid).toBeNull();
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
        NOC_PARENT_PID: "4242",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 9000,
      dataDir: "/var/lib/noc",
      dbFile: "wall.sqlite",
      logLevel: "debug",
      parentPid: 4242,
    });
  });

  test("accepts port 0, which asks the OS for a free one", () => {
    // How the shell starts the sidecar: a fixed port can be held by another copy
    // of the app, and the real port is read back from the ready line.
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

  test.each([["0"], ["-3"], ["12.5"], ["nope"]])(
    "NOC_PARENT_PID=%p",
    (value) => {
      expect(() => readConfig({ NOC_PARENT_PID: value })).toThrow(
        /NOC_PARENT_PID/,
      );
    },
  );

  test("an unknown log level", () => {
    expect(() => readConfig({ NOC_LOG_LEVEL: "shout" })).toThrow(
      /NOC_LOG_LEVEL must be one of/,
    );
  });
});
