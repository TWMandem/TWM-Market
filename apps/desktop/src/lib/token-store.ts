import { invoke } from "@tauri-apps/api/core";

/**
 * Где хранится refresh-токен.
 * В приложении — в «Диспетчере учётных данных» Windows (через Rust).
 * В браузере при разработке интерфейса (pnpm dev:ui) — в sessionStorage,
 * только на время вкладки.
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const DEV_KEY = "twm:dev-refresh-token";

export const tokenStore = {
  async get(): Promise<string | null> {
    if (isTauri()) return (await invoke<string | null>("auth_token_get")) ?? null;
    try {
      return window.sessionStorage.getItem(DEV_KEY);
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
      window.sessionStorage.setItem(DEV_KEY, token);
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
      window.sessionStorage.removeItem(DEV_KEY);
    } catch {
      // ничего
    }
  },
};
