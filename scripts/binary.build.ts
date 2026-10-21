/**
 * Compiles the single-file executable, which is now the only way this ships.
 *
 * A script rather than a longer line in `package.json` for one reason: there is
 * more than one machine to build for, and a monitoring wall is installed by
 * whoever runs the monitoring — an Alpine container, an arm64 box in a rack, a
 * laptop — not by someone with a Bun toolchain to hand. One host build is the
 * daily case and stays the default; `--all` is the release case.
 *
 * The flags are deliberate. `--minify` takes about 1.6 MB off the bundle, and
 * `--sourcemap` embeds a compressed map in the executable itself, so a stack
 * trace still names the `.ts` file and line after the binary has been moved
 * away from every file it was built beside. `--bytecode` is left off: it is
 * keyed to a JSC hash and falls back silently across Bun versions, it has an
 * open ESM bug, and all it buys is process start time — which is nothing to a
 * server that is started once and left running.
 */

import { $ } from "bun";

const SERVER_ENTRY = "./src/server/server.entry.ts";
const OUT_DIR = "./dist";
/** What `bun run build:binary` has always produced; kept so habits still work. */
const HOST_OUTFILE = `${OUT_DIR}/noc`;

/**
 * Targets worth publishing. The musl rows are not duplicates: a glibc binary
 * will not start on Alpine, which is where a lot of monitoring lives. Names are
 * the `--target` value minus its `bun-` prefix, so the file says exactly what
 * it was built as.
 */
const TARGETS = [
  "linux-x64",
  "linux-x64-musl",
  "linux-arm64",
  "linux-arm64-musl",
  "darwin-arm64",
  "darwin-x64",
  "windows-x64",
] as const;

type Built = { name: string; bytes: number };

function outfileFor(target: string): string {
  const suffix = target.startsWith("windows") ? ".exe" : "";
  return `${OUT_DIR}/noc-${target}${suffix}`;
}

/** `target === null` means the host, which Bun compiles for by default. */
async function compile(target: string | null): Promise<Built> {
  const outfile = target === null ? HOST_OUTFILE : outfileFor(target);
  const targetFlag = target === null ? [] : [`--target=bun-${target}`];
  await $`bun build --compile --minify --sourcemap ${targetFlag} ${SERVER_ENTRY} --outfile ${outfile}`;
  return { name: outfile, bytes: Bun.file(outfile).size };
}

const args = Bun.argv.slice(2);
const requested: readonly (string | null)[] = args.includes("--all")
  ? TARGETS
  : args.length > 0
    ? args
    : [null];

const built: Built[] = [];
const failed: { target: string; reason: string }[] = [];

for (const target of requested) {
  try {
    built.push(await compile(target));
  } catch (error) {
    // Kept going rather than thrown: a cross build can fail on its own for
    // reasons the other six do not share, and finding that out after waiting
    // for all of them is better than finding out one at a time.
    failed.push({
      target: target ?? "host",
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;
for (const { name, bytes } of built) console.info(`${name}  ${mb(bytes)}`);
for (const { target, reason } of failed) {
  console.error(`${target} failed: ${reason}`);
}
if (failed.length > 0) process.exit(1);
