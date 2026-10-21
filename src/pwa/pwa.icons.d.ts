/**
 * Why a declaration file in a tree that has none: `tsc` has no idea what an
 * `import … from "./x.png" with { type: "file" }` is, so without this the four
 * icon imports in `pwa.assets.ts` are four TS2307 errors and `bun run typecheck`
 * is red while the server runs perfectly. Bun's own types do not cover the
 * `file` loader's shape.
 *
 * Kept next to the only module that imports a PNG rather than in a project-wide
 * `types/` folder, so it is read by whoever is reading those imports. It is
 * still ambient — a declaration file cannot be scoped to a directory — which is
 * the one thing to know if a second place ever imports an image: it will type
 * as a string there too, and for the bundler that is also correct.
 */

declare module "*.png" {
  /** The path the loader resolved to — in this checkout from source, inside the
   *  executable after `bun build --compile`. Never ours to spell. */
  const path: string;
  export default path;
}
