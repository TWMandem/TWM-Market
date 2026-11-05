import { isTauri } from "./token-store";

/**
 * Ссылка → адрес внутри приложения (#/listing/<id>):
 *  • twm-market://listing/<id> — кнопка «Открыть в приложении» на сайте;
 *  • https://twm-market.ru/l/<id> — ссылка «Поделиться» (на Android открывает
 *    приложение сразу, если оно установлено);
 *  • twm-market://open/chats/<id> и т. п. — нажатие на уведомление Android.
 * Всё остальное игнорируется.
 */
/** Экраны, которые можно открыть из уведомления Android (twm-market://open/…). */
const OPEN_PATHS = [
  /^\/chats(?:\/[0-9a-f-]{36})?$/,
  /^\/listing\/[0-9a-f-]{36}$/,
  /^\/(?:account|favorites|my\/listings|my\/searches)$/,
  /^\/admin(?:\/[a-z-]{1,30})?$/,
];

export function routeFromDeepLink(url: string): string | null {
  const value = url.trim();
  const open = /^twm-market:\/\/open(\/[a-z0-9/-]{1,120})$/i.exec(value);
  if (open) {
    const path = open[1]!.toLowerCase();
    return OPEN_PATHS.some((re) => re.test(path)) ? path : null;
  }
  const match =
    /^twm-market:\/\/listing\/([0-9a-f-]{36})\/?$/i.exec(value) ??
    /^https:\/\/(?:www\.)?twm-market\.ru\/l\/([0-9a-f-]{36})\/?(?:[?#].*)?$/i.exec(value);
  return match ? `/listing/${match[1]!.toLowerCase()}` : null;
}

/**
 * Ссылки на объявления снаружи приложения: кнопка «Открыть в приложении»
 * на сайте и (на Android) ссылки twm-market.ru/l/… из мессенджеров.
 * Работает только в собранном приложении: в браузере ничего не делает.
 */
export async function installDeepLinks(navigate: (path: string) => void): Promise<void> {
  if (!isTauri()) return;
  const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
  const open = (urls: string[] | null) => {
    for (const url of urls ?? []) {
      const route = routeFromDeepLink(url);
      if (route) {
        navigate(route);
        return;
      }
    }
  };
  // Приложение запущено по ссылке.
  open(await getCurrent().catch(() => null));
  // Ссылка пришла, когда приложение уже открыто.
  await onOpenUrl(open);
}
