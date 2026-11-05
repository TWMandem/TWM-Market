import { invoke } from "@tauri-apps/api/core";

/**
 * Где хранится refresh-токен.
 * В приложении — в «Диспетчере учётных данных» Windows или в личной папке
 * приложения на Android (через Rust).
 * В веб-приложении (iPhone) — в localStorage этого сайта: вход сохраняется
 * между запусками. Скрипты на странице — только свои (CSP), чужой код
 * токен не прочитает.
 * В браузере при разработке интерфейса (pnpm dev:ui) — в sessionStorage,
 * только на время вкладки.
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const WEB = import.meta.env?.VITE_WEB === "1";
/** Ключ refresh-токена в localStorage веб-версии. */
export const REFRESH_TOKEN_KEY = "twm:refresh-token";
const DEV_KEY = WEB ? REFRESH_TOKEN_KEY : "twm:dev-refresh-token";
const storage = (): Storage => (WEB ? window.localStorage : window.sessionStorage);

export const tokenStore = {
  async get(): Promise<string | null> {
    if (isTauri()) return (await invoke<string | null>("auth_token_get")) ?? null;
    try {
      return storage().getItem(DEV_KEY);
    } catch {
      return null;
    }
  },

  async set(token: string): Promise<void> {
    if (isTauri()) {
      await invoke("auth_token_set", { token });
      return;
    }
    try {
      storage().setItem(DEV_KEY, token);
    } catch {
      // Только для разработки: без хранилища вход просто не переживёт перезагрузку.
    }
  },

  async clear(): Promise<void> {
    if (isTauri()) {
      await invoke("auth_token_clear");
      return;
    }
    try {
      storage().removeItem(DEV_KEY);
    } catch {
      // ничего
    }
  },
};
