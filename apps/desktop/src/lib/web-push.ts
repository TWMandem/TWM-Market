import { api } from "./api";
import { API_URL } from "./config";
import { IS_IOS, IS_WEB_APP, isStandalone } from "./platform";
import { readSetting, writeSetting } from "./storage";

/**
 * Веб-приложение (iPhone и браузеры): служебный скрипт sw.js показывает
 * уведомления, которые сервер присылает через Web Push, даже когда
 * приложение закрыто. На iPhone это работает только для приложения,
 * добавленного «На экран Домой» (iOS 16.4 и новее).
 *
 * Служебный скрипт НЕ кэширует страницы и файлы приложения: новая версия
 * открывается сразу после выпуска, без «застрявшего» старого кэша.
 */

const TOKEN_KEY = "webPushToken";
/** Для какого аккаунта включены уведомления на этом устройстве. */
const USER_KEY = "webPushUser";

export type WebPushState =
  /** Не веб-приложение или браузер не умеет Web Push. */
  | "unsupported"
  /** iPhone: сначала добавить на экран «Домой». */
  | "needs-install"
  /** Игрок запретил уведомления в настройках браузера или телефона. */
  | "denied"
  | "off"
  | "on";

function supported(): boolean {
  return IS_WEB_APP && typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Регистрация служебного скрипта при запуске веб-приложения. */
export async function registerServiceWorker(navigate: (path: string) => void): Promise<void> {
  if (!IS_WEB_APP || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: "none" });
    // Нажатие на уведомление, когда приложение уже открыто: sw.js просит перейти на экран.
    navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as { type?: string; path?: string } | null;
      if (data?.type === "navigate" && typeof data.path === "string") navigate(data.path);
    });
  } catch {
    // Нет HTTPS или браузер без служебных скриптов — приложение работает и так.
  }
}

export async function webPushState(): Promise<WebPushState> {
  if (!IS_WEB_APP) return "unsupported";
  if (IS_IOS && !isStandalone()) return "needs-install";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    const subscription = await registration?.pushManager.getSubscription();
    return subscription && readSetting(TOKEN_KEY) ? "on" : "off";
  } catch {
    return "off";
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * Включить уведомления. Вызывать по нажатию кнопки: iPhone спрашивает
 * разрешение только в ответ на действие игрока.
 */
export async function enableWebPush(userId: string): Promise<WebPushState> {
  if (!supported()) return webPushState();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await api.webPushKey();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
    });
  }
  const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { token } = await api.registerWebPush({ endpoint: json.endpoint, keys: json.keys });
  writeSetting(TOKEN_KEY, token);
  writeSetting(USER_KEY, userId);
  return "on";
}

/** Выключить на этом устройстве (и при выходе из аккаунта). */
export async function disableWebPush(): Promise<void> {
  if (!IS_WEB_APP) return;
  const token = readSetting(TOKEN_KEY);
  writeSetting(TOKEN_KEY, "");
  writeSetting(USER_KEY, "");
  try {
    if (token) await fetch(`${API_URL}/v1/push/device`, { method: "DELETE", headers: { Authorization: `Device ${token}` } });
  } catch {
    // Сервер всё равно забудет подписку, когда браузер перестанет её принимать.
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    await (await registration?.pushManager.getSubscription())?.unsubscribe();
  } catch {
    // ничего
  }
}

/** Уведомления через Web Push включены: приложение само не показывает их второй раз. */
export function webPushActive(): boolean {
  return IS_WEB_APP && Boolean(readSetting(TOKEN_KEY));
}

/**
 * При запуске (игрок вошёл): если уведомления уже разрешены и подписка есть —
 * напомнить о ней серверу. Так подписка восстанавливается после «Выйти на
 * всех устройствах» и после того, как браузер сменил её сам. Разрешение здесь
 * не спрашивается — только по кнопке.
 */
export async function syncWebPush(userId: string): Promise<void> {
  if (!supported()) return;
  try {
    if (Notification.permission !== "granted") {
      if (readSetting(TOKEN_KEY)) writeSetting(TOKEN_KEY, "");
      return;
    }
    const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) {
      if (readSetting(TOKEN_KEY)) writeSetting(TOKEN_KEY, "");
      return;
    }
    // Игрок сам выключил уведомления в приложении — не включаем обратно.
    // Вошёл другой игрок — ему уведомления не включаем без его нажатия.
    if (!readSetting(TOKEN_KEY) || readSetting(USER_KEY) !== userId) {
      writeSetting(TOKEN_KEY, "");
      await subscription.unsubscribe().catch(() => false);
      return;
    }
    const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    const { token } = await api.registerWebPush({ endpoint: json.endpoint, keys: json.keys });
    writeSetting(TOKEN_KEY, token);
  } catch {
    // Нет связи — попробуем при следующем запуске.
  }
}
