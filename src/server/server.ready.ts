/**
 * The handshake line the sidecar prints once it is listening.
 *
 * In production the port is ephemeral (`NOC_PORT=0`), so the shell that spawned
 * this process cannot know the origin in advance — it reads it here. The format
 * is a contract with `src-tauri/src/sidecar.rs`, which matches this exact
 * prefix on stdout; changing it means changing that file too.
 */

export const READY_LINE_PREFIX = "noc-ready ";

export function readyLine(url: string): string {
  return `${READY_LINE_PREFIX}${url}`;
}
