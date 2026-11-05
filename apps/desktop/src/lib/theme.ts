import { useSyncExternalStore } from "react";
import { readSetting, writeSetting } from "./storage";
import { isTauri } from "./token-store";

/**
 * Тема оформления: тёмная, светлая или как в Windows. Выбор хранится на этом
 * компьютере. Цвета задаются токенами в styles.css: для светлой темы они
 * переопределяются у <html data-theme="light">.
 */
export type ThemePreference = "system" | "dark" | "light";
export type Theme = "dark" | "light";

export const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; icon: "monitor" | "moon" | "sun" }> = [
  { value: "system", label: "Как в Windows", icon: "monitor" },
  { value: "dark", label: "Тёмная", icon: "moon" },
  { value: "light", label: "Светлая", icon: "sun" },
];

const KEY = "theme";
const listeners = new Set<() => void>();
let preference: ThemePreference = readPreference();

function readPreference(): ThemePreference {
  const value = readSetting(KEY);
  return value === "dark" || value === "light" ? value : "system";
}

function systemTheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function resolveTheme(pref: ThemePreference): Theme {
  return pref === "system" ? systemTheme() : pref;
}

function apply(): void {
  const theme = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  // Заголовок окна Windows — в тон приложению (null — как в системе).
  if (isTauri()) {
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(preference === "system" ? null : preference))
      .catch(() => {});
  }
  for (const listener of listeners) listener();
}

/** Вызывается один раз до отрисовки, чтобы не мигала другая тема. */
export function initTheme(): void {
  apply();
  try {
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
      if (preference === "system") apply();
    });
  } catch {
    // Старый WebView без matchMedia — остаётся выбранная тема.
  }
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  writeSetting(KEY, next);
  apply();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Выбранная настройка и тема, которая сейчас на экране. */
export function useTheme(): { preference: ThemePreference; theme: Theme; setPreference: (next: ThemePreference) => void } {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => `${preference}:${resolveTheme(preference)}`,
    () => "system:dark",
  );
  const [pref, theme] = snapshot.split(":") as [ThemePreference, Theme];
  return { preference: pref, theme, setPreference: setThemePreference };
}
