"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Light or dark, chosen by the person using the editor.
 *
 * The choice is an attribute on <html> — globals.css defines the light palette
 * on :root and the dark one under [data-theme="dark"] — and it is mirrored into
 * localStorage so it survives a reload. Nothing else in the app reads the
 * preference: everything follows the tokens.
 */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "technical-infographic:theme";
const DEFAULT_THEME: Theme = "light";

/** Runs before first paint, inlined into the document head. Keep it standalone. */
export const themeBootScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t!=="light"&&t!=="dark"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="light";}})();`;

const listeners = new Set<() => void>();

function currentTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  return window.document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  window.document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // A browser with storage blocked still gets the theme for this session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => DEFAULT_THEME);
  const toggle = useCallback(() => applyTheme(currentTheme() === "dark" ? "light" : "dark"), []);
  return { theme, toggle, setTheme: applyTheme };
}
