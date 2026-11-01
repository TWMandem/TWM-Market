import { isTauri } from "./token-store";
import { readSetting, writeSetting } from "./storage";

/**
 * Всплывающие уведомления Windows. В приложении — через плагин Tauri,
 * в браузере при разработке — через Notification API.
 */

const SETTING = "notifications";

export function notificationsEnabled(): boolean {
  return readSetting(SETTING) !== "off";
}

export function setNotificationsEnabled(on: boolean): void {
  writeSetting(SETTING, on ? "on" : "off");
}

/** Приложение не на переднем плане: свёрнуто, спрятано в трей или окно не в фокусе. */
export async function appInBackground(): Promise<boolean> {
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const [visible, focused] = await Promise.all([win.isVisible(), win.isFocused()]);
      return !visible || !focused;
    } catch {
      return !document.hasFocus();
    }
  }
  return document.visibilityState !== "visible" || !document.hasFocus();
}

export async function showSystemNotification(title: string, body: string): Promise<void> {
  if (!notificationsEnabled()) return;
  try {
    if (isTauri()) {
      const plugin = await import("@tauri-apps/plugin-notification");
      let granted = await plugin.isPermissionGranted();
      if (!granted) granted = (await plugin.requestPermission()) === "granted";
      if (granted) plugin.sendNotification({ title, body });
      return;
    }
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission === "granted") new Notification(title, { body });
  } catch {
    // Уведомление — удобство: если не получилось, счётчики в приложении всё равно обновятся.
  }
}
