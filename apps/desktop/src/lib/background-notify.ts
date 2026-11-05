import { invoke } from "@tauri-apps/api/core";
import type { NotificationDto } from "@twm/shared";
import { api } from "./api";
import { API_URL } from "./config";
import { notificationsEnabled } from "./desktop-notify";
import { isAndroidApp } from "./platform";

/**
 * Уведомления на Android, когда приложение закрыто. Раз в ~15 минут Android
 * будит фоновую задачу, она спрашивает сервер о новых уведомлениях по ключу
 * устройства (он годится только для чтения уведомлений) и показывает их.
 * На компьютере ничего не делает.
 */

interface Status {
  active: boolean;
  permission: boolean;
}

/** Включить или выключить фоновую проверку по входу и настройке «Уведомления». */
export async function syncBackgroundNotifications(authed: boolean): Promise<void> {
  if (!isAndroidApp()) return;
  try {
    const want = authed && notificationsEnabled();
    const status = await invoke<Status>("plugin:background-notify|status");
    if (want && !status.active) {
      // Android 13+: разрешение на уведомления спрашивается один раз.
      const plugin = await import("@tauri-apps/plugin-notification");
      if (!(await plugin.isPermissionGranted())) await plugin.requestPermission();
      const { token } = await api.registerPushDevice();
      await invoke("plugin:background-notify|start", { apiUrl: API_URL, token });
    } else if (!want && status.active) {
      await stopBackgroundNotifications();
    }
  } catch {
    // Не получилось — уведомления будут приходить, пока приложение открыто.
  }
}

/** Выход из аккаунта или выключение: остановить проверку и отозвать ключ устройства. */
export async function stopBackgroundNotifications(): Promise<void> {
  if (!isAndroidApp()) return;
  try {
    const { token } = await invoke<{ token?: string }>("plugin:background-notify|stop");
    if (token) await fetch(`${API_URL}/v1/push/device`, { method: "DELETE", headers: { Authorization: `Device ${token}` } });
  } catch {
    // Ключ всё равно перестанет действовать при «Выйти на всех устройствах».
  }
}

/**
 * Приложение само получило уведомления: Android-часть покажет их как
 * уведомления Android, если приложение свёрнуто (на экране — не показывает),
 * и сдвинет отметку, чтобы фоновая проверка их не повторила.
 */
export async function androidNotify(items: NotificationDto[], cursor: number, show: boolean): Promise<void> {
  if (!isAndroidApp()) return;
  try {
    if (show && notificationsEnabled()) {
      for (const n of items.slice(-3)) {
        await invoke("plugin:background-notify|notify", { id: n.id, title: n.title, body: n.body, link: n.link });
      }
    }
    await invoke("plugin:background-notify|seen", { id: cursor });
  } catch {
    // Плагина нет (старая сборка) — не страшно.
  }
}

/**
 * Android рисует приложение под строкой состояния и панелью жестов: их высота
 * приходит CSS-переменными --safe-top / --safe-bottom (шапка и нижняя панель
 * отступают на эту высоту). Здесь — первое значение при запуске.
 */
export async function initAndroidInsets(): Promise<void> {
  if (!isAndroidApp()) return;
  try {
    const { top, bottom } = await invoke<{ top: number; bottom: number }>("plugin:background-notify|insets");
    const root = document.documentElement.style;
    if (top > 0) root.setProperty("--safe-top", `${top}px`);
    if (bottom > 0) root.setProperty("--safe-bottom", `${bottom}px`);
  } catch {
    // Старая сборка — без отступов.
  }
}

/** Цвет значков строки состояния под тему: тёмные значки на светлой теме. */
export function setAndroidStatusBar(light: boolean): void {
  if (!isAndroidApp()) return;
  invoke("plugin:background-notify|status_bar", { light }).catch(() => {});
}
