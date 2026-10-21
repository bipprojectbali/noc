/** Single owner of every environment-derived literal in the app. */

import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export type LogLevel = "error" | "warn" | "info" | "debug";

/**
 * Where the process is running, as far as the data directory cares.
 *
 * Passed in rather than read here so the branch stays a pure function of its
 * inputs: a test can ask for the Windows answer on macOS, and for the
 * standalone answer under `bun test`, without setting a variable on the whole
 * process.
 */
export type ConfigRuntime = {
  /** True inside a `bun build --compile` executable. */
  standalone: boolean;
  /** `process.platform`; only `darwin` and `win32` are told apart. */
  platform: string;
};

export type NocConfig = {
  host: string;
  /** `0` asks the OS for an ephemeral port; the real one is only known once bound. */
  port: number;
  /**
   * Relative under `bun run dev`/`start` and absolute in the compiled binary —
   * see `defaultDataDir`. Either way it is resolved against an explicit base by
   * `databasePath`, never against the working directory.
   */
  dataDir: string;
  dbFile: string;
  logLevel: LogLevel;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7788;
const DEFAULT_DATA_DIR = ".noc-data";
const DEFAULT_DB_FILE = "noc.sqlite";
const DEFAULT_LOG_LEVEL: LogLevel = "info";

/**
 * Directory name under the per-user data root.
 *
 * Reverse-DNS because that is the macOS convention, and this exact string
 * because it is the identifier the deleted native shell used: an operator who
 * ever ran the app bundle already has a wall in
 * `~/Library/Application Support/dev.noc.wall`, and the binary should find it
 * rather than start empty beside it. One name on every platform means one
 * answer to "where is my database".
 */
const APP_DIR_NAME = "dev.noc.wall";

const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug"];

/** `0` is legal and means "let the OS pick"; see `NocConfig.port`. */
const PORT_MIN = 0;
const PORT_MAX = 65535;

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new Error(
      `NOC_PORT must be an integer between ${PORT_MIN} and ${PORT_MAX}, received "${raw}"`,
    );
  }
  return port;
}

function readLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined || raw === "") return DEFAULT_LOG_LEVEL;
  if (!LOG_LEVELS.includes(raw as LogLevel)) {
    throw new Error(
      `NOC_LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}, received "${raw}"`,
    );
  }
  return raw as LogLevel;
}

/**
 * Home directory. `USERPROFILE` is asked first on Windows because `HOME` there
 * is usually absent and, when present, often a MSYS-style path set by a shell
 * rather than the profile the OS means. The last two fallbacks are only
 * reachable on a host with no home directory at all.
 */
function homeOf(
  env: Record<string, string | undefined>,
  platform: string,
): string {
  const preferred = platform === "win32" ? env.USERPROFILE : env.HOME;
  return preferred || env.HOME || env.USERPROFILE || homedir() || tmpdir();
}

/**
 * Per-user data root by platform convention, so a downloaded binary writes
 * where the OS expects rather than beside wherever it was launched from.
 */
function perUserDataDir(
  env: Record<string, string | undefined>,
  platform: string,
): string {
  const home = homeOf(env, platform);
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", APP_DIR_NAME);
  }
  if (platform === "win32") {
    return join(env.APPDATA || join(home, "AppData", "Roaming"), APP_DIR_NAME);
  }
  // The XDG spec says a relative `XDG_DATA_HOME` is invalid and must be
  // ignored, which matters here: accepting one would hand back the very
  // cwd-relative path this function exists to avoid.
  const xdg = env.XDG_DATA_HOME;
  const base =
    xdg !== undefined && isAbsolute(xdg) ? xdg : join(home, ".local", "share");
  return join(base, APP_DIR_NAME);
}

/**
 * Where the wall keeps its database when the operator did not say.
 *
 * `.noc-data` is right for `bun run dev` and `bun run start` — the cwd is the
 * project, and `rm -rf .noc-data` is the reset — but it is a trap for a
 * distributed executable, which the OS may launch with its cwd at `/` or on a
 * read-only mount. That trap has already been sprung once: the native shell
 * inherited cwd `/` from Finder and the whole wall ran with its database at
 * `/.noc-data/noc.sqlite`, unable to save anything. The shell fixed it by
 * resolving a per-application directory before spawning the server; the shell
 * is gone, so the binary has to resolve it itself.
 */
function defaultDataDir(
  env: Record<string, string | undefined>,
  runtime: ConfigRuntime,
): string {
  return runtime.standalone
    ? perUserDataDir(env, runtime.platform)
    : DEFAULT_DATA_DIR;
}

/** What `readConfig` assumes when a caller does not describe the process. */
export function currentRuntime(): ConfigRuntime {
  return {
    standalone: Bun.isStandaloneExecutable,
    platform: process.platform,
  };
}

/**
 * Parses and validates config from an environment record.
 *
 * Every value an operator can set is validated here and decided nowhere else.
 * The only value this function *decides* is the data directory, and only when
 * it was left unset — see `defaultDataDir` for why a compiled binary cannot be
 * allowed to inherit the dev server's relative default. An explicit
 * `NOC_DATA_DIR` always wins, and an empty one counts as unset exactly like
 * every other variable here, so `NOC_DATA_DIR=""` cannot quietly put the
 * cwd-relative path back.
 *
 * `host` defaults to loopback on purpose: binding to 0.0.0.0 exposes the saved
 * layout and the internal URL list to the local network, so widening it has to
 * be a deliberate act by the operator.
 */
export function readConfig(
  env: Record<string, string | undefined>,
  runtime: ConfigRuntime = currentRuntime(),
): NocConfig {
  return {
    host: env.NOC_HOST || DEFAULT_HOST,
    port: readPort(env.NOC_PORT),
    dataDir: env.NOC_DATA_DIR || defaultDataDir(env, runtime),
    dbFile: env.NOC_DB_FILE || DEFAULT_DB_FILE,
    logLevel: readLogLevel(env.NOC_LOG_LEVEL),
  };
}

/**
 * Absolute path of the SQLite file.
 *
 * Resolved against an explicit base rather than read from `process.cwd()` so a
 * relative `NOC_DATA_DIR` cannot silently point at a different database when
 * the compiled binary is started from another directory. The file must live in
 * the data directory and never inside the executable: a database embedded by
 * `bun build --compile` accepts writes and then loses every one of them when
 * the process exits.
 */
export function databasePath(config: NocConfig, baseDir: string): string {
  return resolve(baseDir, config.dataDir, config.dbFile);
}
