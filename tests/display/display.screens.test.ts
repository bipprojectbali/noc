/**
 * The naming, which is the only part of screen selection that is logic rather
 * than a call into the platform. It matters because both of its inputs are
 * routinely useless: Chromium returns `label: ""` on platforms that give it
 * nothing, and two identical monitors return byte-identical labels — so a menu
 * built straight from the API is either a column of blanks or two rows nobody
 * can tell apart, and picking the wrong one sends the wall to the wrong wall.
 *
 * `describeScreens` is pure and takes the shape it reads, so these are plain
 * objects. happy-dom turns out to implement `getScreenDetails` as well — one
 * unnamed primary screen — so `readScreens` is exercised for real here too.
 * What no test can reach: a second screen, a refused permission, and
 * `requestFullscreen`, which happy-dom does not have. Whether naming a screen
 * lights up that screen needs a browser and two monitors.
 */

import { describe, expect, test } from "bun:test";

import {
  describeScreens,
  fillScreen,
  readScreens,
  screenAccess,
} from "../../src/display/display.screens.ts";

/** The subset `describeScreens` reads; `currentScreen` is one of these by spec. */
function detailsOf(labels: readonly (string | undefined)[], current = 0) {
  const screens = labels.map((label, index) => ({
    ...(label === undefined ? {} : { label }),
    isPrimary: index === 0,
  }));
  const currentScreen = screens[current];
  if (currentScreen === undefined) throw new Error("current screen out of range");
  return { screens, currentScreen };
}

describe("naming the screens", () => {
  test("an unnamed screen is numbered rather than left blank", () => {
    const named = describeScreens(detailsOf(["", undefined]));
    expect(named.map((screen) => screen.name)).toEqual(["Screen 1", "Screen 2"]);
  });

  test("a label the platform does give is used as it is", () => {
    const named = describeScreens(detailsOf(["Built-in Retina Display", "DELL U2720Q"]));
    expect(named.map((screen) => screen.name)).toEqual([
      "Built-in Retina Display",
      "DELL U2720Q",
    ]);
  });

  test("two identical monitors are told apart, and only they are numbered", () => {
    const named = describeScreens(detailsOf(["DELL U2720Q", "DELL U2720Q", "Laptop"]));
    expect(named.map((screen) => screen.name)).toEqual([
      "DELL U2720Q (1)",
      "DELL U2720Q (2)",
      "Laptop",
    ]);
  });

  test("whitespace is not a name", () => {
    expect(describeScreens(detailsOf(["   "]))[0]?.name).toBe("Screen 1");
  });
});

describe("what the list carries", () => {
  test("the screen the wall is on is marked, and only that one", () => {
    const named = describeScreens(detailsOf(["a", "b", "c"], 1));
    expect(named.map((screen) => screen.current)).toEqual([false, true, false]);
  });

  test("primary is reported, since it is the one the operator did not choose", () => {
    const named = describeScreens(detailsOf(["a", "b"]));
    expect(named.map((screen) => screen.primary)).toEqual([true, false]);
  });

  test("ids are positional and distinct, because the API offers no stable one", () => {
    const ids = describeScreens(detailsOf(["a", "a", "a"])).map((screen) => screen.id);
    expect(new Set(ids).size).toBe(3);
  });

  test("the platform object is carried through untouched for requestFullscreen", () => {
    const details = detailsOf(["a"]);
    expect(describeScreens(details)[0]?.handle).toBe(details.screens[0]);
  });

  test("the platform's own order is kept", () => {
    const named = describeScreens(detailsOf(["z", "a", "m"]));
    expect(named.map((screen) => screen.name)).toEqual(["z", "a", "m"]);
  });
});

describe("reading the screens the browser offers", () => {
  // happy-dom implements `getScreenDetails` — one unnamed primary screen — so
  // the whole chain runs here, not just its edges. What it cannot provide is a
  // second screen or a real permission decision.

  test("a granted browser is listed through, numbered because it has no label", async () => {
    const result = await readScreens();
    expect(result).toEqual({
      ok: true,
      screens: [
        { id: "0", name: "Screen 1", primary: true, current: true, handle: expect.anything() },
      ],
    });
  });
});

describe("a browser without the Window Management API", () => {
  /**
   * The fallback that matters: the API is Chromium-only, and Firefox and Safari
   * are the majority of what will ever open this page. Neither function may
   * throw there, because the control renders either way and a throw would take
   * the whole wall with it.
   */
  async function withoutTheApi<T>(run: () => Promise<T>): Promise<T> {
    const host = globalThis as { getScreenDetails?: unknown };
    const saved = host.getScreenDetails;
    delete host.getScreenDetails;
    try {
      return await run();
    } finally {
      host.getScreenDetails = saved;
    }
  }

  test("reports no access rather than throwing", async () => {
    expect(await withoutTheApi(screenAccess)).toBe("unavailable");
  });

  test("refuses to list screens instead of failing the render", async () => {
    expect(await withoutTheApi(readScreens)).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("filling the screen", () => {
  test("a refused request comes back as a reason, never a thrown error", async () => {
    // happy-dom has no `requestFullscreen`; a real browser rejects the promise
    // when there was no user gesture. Either way the control needs something to
    // show, because a button that silently does nothing reads as broken.
    const result = await fillScreen(document.createElement("div"), null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toBe("");
  });
});
