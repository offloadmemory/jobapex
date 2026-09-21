import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyTheme } from "./theme";

/**
 * theme.ts is the only DOM consumer in this suite, so it runs against a stub of
 * exactly the surface it touches — `documentElement.classList`, `dataset` and
 * `matchMedia` — instead of pulling a browser environment into the node suite.
 * The stub is in place before any test runs because the module reads no globals
 * until `applyTheme` is called. The module installs its OS-scheme listener once,
 * so these tests share the one imported instance and have to run in order.
 */
const classes = new Set<string>();
const root = {
  classList: {
    toggle(name: string, force: boolean): void {
      if (force) classes.add(name);
      else classes.delete(name);
    },
  },
  dataset: {} as Record<string, string>,
};

const listeners: Array<() => void> = [];
let osPaintsDark = false;
const mediaQuery = {
  get matches(): boolean {
    return osPaintsDark;
  },
  addEventListener(_type: string, handler: () => void): void {
    listeners.push(handler);
  },
};

vi.stubGlobal("document", { documentElement: root });
vi.stubGlobal("window", { matchMedia: () => mediaQuery });

/** Stand in for the OS flipping appearance while the app is open. */
function osSwitchesTo(dark: boolean): void {
  osPaintsDark = dark;
  for (const listener of listeners) listener();
}

describe("applyTheme", () => {
  beforeEach(() => {
    osPaintsDark = false;
    classes.clear();
  });

  it("paints the accent and the absolute modes on <html>", () => {
    applyTheme("dark", "rose");
    expect(classes.has("dark")).toBe(true);
    expect(root.dataset["accent"]).toBe("rose");

    applyTheme("light", "blue");
    expect(classes.has("dark")).toBe(false);
    expect(root.dataset["accent"]).toBe("blue");
  });

  it("paints neutral as an accent too, so no stale hue survives the switch", () => {
    applyTheme("dark", "amber");
    applyTheme("dark", "neutral");
    expect(root.dataset["accent"]).toBe("neutral");
  });

  it("follows the OS in system mode and keeps the accent when it flips", () => {
    applyTheme("system", "emerald");
    expect(classes.has("dark")).toBe(false);

    osSwitchesTo(true);
    expect(classes.has("dark")).toBe(true);
    // The listener repaints on its own; a mode the OS can change must not drop
    // the accent chosen in the same call.
    expect(root.dataset["accent"]).toBe("emerald");
  });

  it("ignores the OS scheme once an absolute mode is chosen", () => {
    applyTheme("light", "violet");
    osSwitchesTo(true);
    expect(classes.has("dark")).toBe(false);
  });
});
