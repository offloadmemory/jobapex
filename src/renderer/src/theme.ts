import type { AccentColor, ThemeMode } from "@shared/wire";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * The appearance the OS-scheme listener re-applies. Module-level because the
 * listener outlives every render and must not be reinstalled per theme change.
 */
let mode: ThemeMode = "system";
let accent: AccentColor = "neutral";
let query: MediaQueryList | null = null;
let watching = false;

function darkQuery(): MediaQueryList {
  if (query) return query;
  const created = window.matchMedia(DARK_QUERY);
  query = created;
  return created;
}

/** "system" is the only mode that depends on the OS; the other two are absolute. */
function paintsDark(next: ThemeMode): boolean {
  return next === "dark" || (next === "system" && darkQuery().matches);
}

/**
 * Both appearance axes live on <html>: `dark` picks the `.dark` token block in
 * index.css, `data-accent` the accent block layered on top of it. `neutral` has
 * no accent block, so it paints only as the absence of one.
 */
function paint(): void {
  const root = document.documentElement;
  root.classList.toggle("dark", paintsDark(mode));
  root.dataset["accent"] = accent;
}

export function applyTheme(next: ThemeMode, nextAccent: AccentColor): void {
  mode = next;
  accent = nextAccent;
  paint();
  if (watching) return;
  watching = true;
  // Installed once: with "system" selected, a live OS switch has to repaint the
  // palette without anything in React re-rendering.
  darkQuery().addEventListener("change", paint);
}
