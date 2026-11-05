import { isTauri } from "./token-store";

/**
 * Где запущено приложение: на компьютере (Windows), на телефоне (Android)
 * или в браузере при разработке. От этого зависят автообновление,
 * 3D-предпросмотр одежды (нужны файлы игры на компьютере) и трей.
 */
export const IS_ANDROID = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/** Приложение для компьютера (Tauri, не Android). */
export function isDesktopApp(): boolean {
  return isTauri() && !IS_ANDROID;
}

/** Приложение для Android. */
export function isAndroidApp(): boolean {
  return isTauri() && IS_ANDROID;
}

/** Открыть ссылку во внешнем браузере (в приложении) или в новой вкладке. */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}
