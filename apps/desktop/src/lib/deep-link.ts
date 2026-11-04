import { isTauri } from "./token-store";

/** twm-market://listing/<id> → адрес внутри приложения (#/listing/<id>). */
export function routeFromDeepLink(url: string): string | null {
  const match = /^twm-market:\/\/listing\/([0-9a-f-]{36})\/?$/i.exec(url.trim());
  return match ? `/listing/${match[1]!.toLowerCase()}` : null;
}

/**
 * Ссылки со страницы объявления на сайте («Открыть в приложении»).
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
