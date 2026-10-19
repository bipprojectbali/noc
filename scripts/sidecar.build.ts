/**
 * Compiles the Bun server into the binary Tauri ships as a sidecar.
 *
 * Tauri resolves an `externalBin` entry by appending the target triple, so the
 * file has to be named for the machine it was built on. The triple comes from
 * rustc rather than from a table of our own: it is the same value Tauri asks
 * rustc for, and a guess that disagrees fails at bundle time.
 */

import { $ } from "bun";

const SIDECAR_NAME = "noc-server";
const SERVER_ENTRY = "./src/server/server.entry.ts";
const BINARIES_DIR = "src-tauri/binaries";

const repoRoot = new URL("..", import.meta.url).pathname;

async function hostTriple(): Promise<string> {
  const triple = (await $`rustc --print host-tuple`.text()).trim();
  if (triple === "") {
    throw new Error("rustc reported an empty host triple; is the toolchain installed?");
  }
  return triple;
}

const triple = await hostTriple();
const outfile = `${BINARIES_DIR}/${SIDECAR_NAME}-${triple}`;

await $`bun build --compile ${SERVER_ENTRY} --outfile ${outfile}`.cwd(repoRoot);
console.info(`Sidecar built: ${outfile}`);
