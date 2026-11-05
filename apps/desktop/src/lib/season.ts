import { useSyncExternalStore } from "react";
import type { Season } from "@twm/shared";
import { api } from "./api";
import { readSetting, writeSetting } from "./storage";

/**
 * Праздничное оформление. Включает его администратор на сервере (без нового
 * выпуска приложения); приложение спрашивает при запуске и раз в полчаса.
 * Игрок может скрыть оформление у себя — настройка этого устройства.
 * На экране оно видно как <html data-season="halloween">.
 */
const KEY = "seasonDecor";
const REFRESH_MS = 30 * 60 * 1000;

let server: Season | null = null;
let enabled = readSetting(KEY) !== "off";
const listeners = new Set<() => void>();

function apply(): void {
  const active = enabled ? server : null;
  const root = document.documentElement;
  if (active) root.dataset.season = active;
  else delete root.dataset.season;
  for (const listener of listeners) listener();
}

export async function refreshSeason(): Promise<void> {
  try {
    const { season } = await api.appearance();
    if (season !== server) {
      server = season;
      apply();
    }
  } catch {
    // Нет связи — оставляем как было.
  }
}

let started = false;
/** Вызывается один раз при запуске. */
export function initSeason(): void {
  if (started) return;
  started = true;
  void refreshSeason();
  window.setInterval(() => void refreshSeason(), REFRESH_MS);
}

export function setSeasonDecorEnabled(next: boolean): void {
  enabled = next;
  writeSetting(KEY, next ? "on" : "off");
  apply();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** season — что включено на сервере; active — что видно на экране (с учётом выбора игрока). */
export function useSeason(): { season: Season | null; active: Season | null; enabled: boolean } {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => `${server ?? ""}|${enabled ? "1" : "0"}`,
    () => "|1",
  );
  const [s, e] = snapshot.split("|") as [string, string];
  const season = (s || null) as Season | null;
  return { season, active: e === "1" ? season : null, enabled: e === "1" };
}
