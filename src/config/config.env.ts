/** Single owner of every environment-derived literal in the app. */

import { resolve } from "node:path";

export type LogLevel = "error" | "warn" | "info" | "debug";

export type NocConfig = {
  host: string;
  /** `0` asks the OS for an ephemeral port; the real one is only known once bound. */
  port: number;
  dataDir: string;
  dbFile: string;
  logLevel: LogLevel;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7788;
const DEFAULT_DATA_DIR = ".noc-data";
const DEFAULT_DB_FILE = "noc.sqlite";
const DEFAULT_LOG_LEVEL: LogLevel = "info";

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
 * Parses and validates config from an environment record.
 *
 * The defaults serve `bun run dev` and `bun run start`, where the project
 * directory is the working directory and `rm -rf .noc-data` is a reset. An
 * operator running the compiled binary from elsewhere sets `NOC_DATA_DIR`,
 * which is why `databasePath` below resolves against an explicit base.
 *
 * `host` defaults to loopback on purpose: binding to 0.0.0.0 exposes the saved
 * layout and the internal URL list to the local network, so widening it has to
 * be a deliberate act by the operator.
 */
export function readConfig(env: Record<string, string | undefined>): NocConfig {
  return {
    host: env.NOC_HOST || DEFAULT_HOST,
    port: readPort(env.NOC_PORT),
    dataDir: env.NOC_DATA_DIR || DEFAULT_DATA_DIR,
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
