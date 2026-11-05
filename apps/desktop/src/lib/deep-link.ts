import { isTauri } from "./token-store";

/**
 * Ссылка → адрес внутри приложения (#/listing/<id>):
 *  • twm-market://listing/<id> — кнопка «Открыть в приложении» на сайте;
 *  • https://twm-market.ru/l/<id> — ссылка «Поделиться» (на Android открывает
 *    приложение сразу, если оно установлено).
 * Всё остальное игнорируется.
 */
export function routeFromDeepLink(url: string): string | null {
  const value = url.trim();
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
