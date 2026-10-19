/** Single owner of every environment-derived literal in the app. */

export type LogLevel = "error" | "warn" | "info" | "debug";

export type NocConfig = {
  host: string;
  port: number;
  dataDir: string;
  logLevel: LogLevel;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7788;
const DEFAULT_DATA_DIR = ".noc-data";
const DEFAULT_LOG_LEVEL: LogLevel = "info";

const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug"];

const PORT_MIN = 1;
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
 * Builds config from an environment record.
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
    logLevel: readLogLevel(env.NOC_LOG_LEVEL),
  };
}
