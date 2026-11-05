import { isTauri } from "./token-store";

/**
 * Где запущено приложение: на компьютере (Windows), на телефоне (Android)
 * или в браузере при разработке. От этого зависят автообновление,
 * 3D-предпросмотр одежды (нужны файлы игры на компьютере) и трей.
 */
export const IS_ANDROID = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/** Веб-приложение (сборка build:web, открывается в браузере: twm-market.ru/app/). */
export const IS_WEB_APP = import.meta.env?.VITE_WEB === "1";

/** iPhone или iPad (iPadOS представляется как Mac с сенсорным экраном). */
export const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

/** Веб-приложение открыто с экрана «Домой» (а не во вкладке браузера). */
export function isStandalone(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

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
