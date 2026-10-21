import { describe, expect, test } from "bun:test";
import { join, posix, win32 } from "node:path";

import {
  type ConfigRuntime,
  currentRuntime,
  readConfig,
} from "../../src/config/config.env.ts";

/** A compiled binary on the named platform, with a home directory we control. */
function standalone(platform: string): ConfigRuntime {
  return { standalone: true, platform };
}

const HOME = { HOME: "/home/op", USERPROFILE: "C:\\Users\\op" };

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

describe("the data directory of a compiled binary", () => {
  // A downloaded executable is launched with a working directory nobody chose —
  // Finder uses `/`, and the volume may be read-only. The relative default is
  // right for `bun run dev`/`start` and a silent data-loss trap here, so the
  // binary resolves a per-user directory instead. These assertions are about
  // which root is picked; the separators are `node:path`'s business.
  test.each([
    ["darwin", join("/home/op", "Library", "Application Support")],
    ["linux", join("/home/op", ".local", "share")],
    ["freebsd", join("/home/op", ".local", "share")],
  ])("on %s it sits under %s", (platform, root) => {
    expect(readConfig(HOME, standalone(platform)).dataDir).toBe(
      join(root, "dev.noc.wall"),
    );
  });

  test("on win32 it follows APPDATA", () => {
    expect(
      readConfig(
        { ...HOME, APPDATA: "C:\\Users\\op\\AppData\\Roaming" },
        standalone("win32"),
      ).dataDir,
    ).toBe(join("C:\\Users\\op\\AppData\\Roaming", "dev.noc.wall"));
  });

  test("on win32 without APPDATA it falls back under the profile", () => {
    expect(readConfig(HOME, standalone("win32")).dataDir).toBe(
      join("C:\\Users\\op", "AppData", "Roaming", "dev.noc.wall"),
    );
  });

  test("an absolute XDG_DATA_HOME wins over the XDG default", () => {
    expect(
      readConfig(
        { ...HOME, XDG_DATA_HOME: "/srv/state" },
        standalone("linux"),
      ).dataDir,
    ).toBe(join("/srv/state", "dev.noc.wall"));
  });

  test.each([["state"], [""], ["./state"]])(
    "a relative XDG_DATA_HOME=%p is ignored, as the spec requires",
    (value) => {
      // Honouring one would hand back exactly the cwd-relative path this
      // resolution exists to avoid.
      expect(
        readConfig({ ...HOME, XDG_DATA_HOME: value }, standalone("linux"))
          .dataDir,
      ).toBe(join("/home/op", ".local", "share", "dev.noc.wall"));
    },
  );

  // The whole point: `databasePath` resolves a relative value against the
  // working directory, and the working directory is what we do not trust.
  // Judged by the target platform's own rules — a `C:\…` path is absolute on
  // Windows and nowhere else, and these tests run on one host.
  test.each([
    ["darwin", posix.isAbsolute],
    ["linux", posix.isAbsolute],
    ["win32", win32.isAbsolute],
  ])("the result is absolute on %s", (platform, absolute) => {
    expect(absolute(readConfig(HOME, standalone(platform)).dataDir)).toBe(true);
  });

  test("an explicit NOC_DATA_DIR still wins", () => {
    expect(
      readConfig(
        { ...HOME, NOC_DATA_DIR: "/var/lib/noc" },
        standalone("darwin"),
      ).dataDir,
    ).toBe("/var/lib/noc");
  });

  test("NOC_DATA_DIR='' counts as unset and cannot resurrect the trap", () => {
    const dataDir = readConfig(
      { ...HOME, NOC_DATA_DIR: "" },
      standalone("darwin"),
    ).dataDir;
    expect(dataDir).not.toBe(".noc-data");
    expect(dataDir).toBe(
      join("/home/op", "Library", "Application Support", "dev.noc.wall"),
    );
  });
});

describe("the data directory of the dev server", () => {
  test.each([["darwin"], ["linux"], ["win32"]])(
    "stays the project-relative default on %s",
    (platform) => {
      // `bun run dev` and `bun run start` run with the project as the working
      // directory, where `rm -rf .noc-data` is how you reset the wall.
      expect(
        readConfig(HOME, { standalone: false, platform }).dataDir,
      ).toBe(".noc-data");
    },
  );

  test("which is what an unspecified runtime reports under the test runner", () => {
    // Why every other test in this file still sees `.noc-data` without saying
    // so: `bun test` is not a compiled executable.
    expect(currentRuntime().standalone).toBe(false);
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
