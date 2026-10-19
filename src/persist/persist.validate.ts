/**
 * Boundary validation for anything arriving over HTTP.
 *
 * The frontend is the only intended caller, but the endpoint is reachable by
 * anything that can reach the port, so a payload is treated as hostile until it
 * has been through here. Structural checks on the tree itself are delegated to
 * `parseLayout`, which already refuses malformed and future-versioned layouts.
 */

import { parseLayout, serializeLayout } from "../layout/layout.serializer.ts";
import { isPane, type LayoutTree } from "../layout/layout.types.ts";
import {
  MAX_VIEW_NAME_LENGTH,
  type WallSettings,
  type WallSnapshot,
} from "./persist.types.ts";

/** Hard ceiling on a stored wall, so one request cannot write an unbounded file. */
export const MAX_NODES = 512;

/** Longest URL accepted in a payload. Well past any real dashboard address. */
const MAX_URL_LENGTH = 2048;

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export class PersistInputError extends Error {}

function fail(message: string): never {
  throw new PersistInputError(message);
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`"${field}" must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseSettings(value: unknown): WallSettings {
  const raw = asRecord(value, "settings");
  const cap = raw.paneCap;
  if (typeof cap !== "number" || !Number.isInteger(cap) || cap < 1 || cap > MAX_NODES) {
    fail(`"settings.paneCap" must be an integer between 1 and ${MAX_NODES}`);
  }
  if (typeof raw.urlBarVisibleByDefault !== "boolean") {
    fail('"settings.urlBarVisibleByDefault" must be a boolean');
  }
  return { paneCap: cap, urlBarVisibleByDefault: raw.urlBarVisibleByDefault };
}

function parseStoredUrl(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) {
    fail(`"${field}" must be a string of at most ${MAX_URL_LENGTH} characters`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(`"${field}" is not a valid URL`);
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    // A stored `javascript:` or `file:` url would be handed straight to a frame
    // on the next restart, so it is refused on the way in, not on the way out.
    fail(`"${field}" must use http or https`);
  }
  return value;
}

/**
 * Validates a wall snapshot and returns it in canonical form.
 *
 * Throws `PersistInputError` for anything a client got wrong, which the route
 * turns into a 400 with the message. Errors from `parseLayout` are re-thrown
 * with the same type so a bad tree is also a client error, not a server crash.
 */
export function parseWallSnapshot(value: unknown): WallSnapshot {
  const raw = asRecord(value, "body");

  let tree: LayoutTree;
  try {
    // Migrates an older stored shape forward and rejects a malformed or
    // future-versioned one, so the version stamp below is always the current.
    tree = parseLayout(raw.layout);
  } catch (error) {
    fail(
      `"layout" was rejected: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const nodeCount = Object.keys(tree.nodes).length;
  if (nodeCount > MAX_NODES) {
    fail(`"layout" holds ${nodeCount} nodes, more than the limit of ${MAX_NODES}`);
  }

  const settings = parseSettings(raw.settings);

  const currentUrls: Record<string, string | null> = {};
  if (raw.currentUrls !== undefined) {
    const entries = asRecord(raw.currentUrls, "currentUrls");
    for (const [paneId, url] of Object.entries(entries)) {
      const node = tree.nodes[paneId];
      if (node === undefined || !isPane(node)) {
        fail(`"currentUrls" names "${paneId}", which is not a pane in this layout`);
      }
      currentUrls[paneId] =
        url === null ? null : parseStoredUrl(url, `currentUrls.${paneId}`);
    }
  }

  return { layout: serializeLayout(tree), settings, currentUrls };
}

/**
 * Saved view names double as database keys and as what the user reads in a
 * menu, so control characters and surrounding whitespace are rejected rather
 * than silently trimmed into a name the user did not choose.
 */
export function parseViewName(value: unknown): string {
  if (typeof value !== "string") fail('"name" must be a string');
  if (value.length === 0) fail('"name" must not be empty');
  if (value.length > MAX_VIEW_NAME_LENGTH) {
    fail(`"name" must be at most ${MAX_VIEW_NAME_LENGTH} characters`);
  }
  if (value !== value.trim()) fail('"name" must not start or end with whitespace');
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    fail('"name" must not contain control characters');
  }
  return value;
}
