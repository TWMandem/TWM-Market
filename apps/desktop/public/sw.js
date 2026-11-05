/*
 * Служебный скрипт веб-приложения TWM Market (twm-market.ru/app/).
 * Только уведомления: показывает присланные сервером (Web Push) и по нажатию
 * открывает нужный экран. Страницы и файлы приложения НЕ кэшируются —
 * после выпуска новой версии открывается сразу она.
 */

const BASE = new URL("./", self.location.href).pathname; // /app/

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Ссылки внутри приложения: только пути вида /chats/…, /listing/… */
function safePath(link) {
  return typeof link === "string" && /^\/[a-z0-9/_-]{1,120}$/i.test(link) ? link : "/";
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "TWM Market", body: event.data ? event.data.text() : "" };
  }
  // Каждое присланное уведомление обязательно показывается: иначе iPhone
  // отключает уведомления сайту.
  event.waitUntil(
    self.registration.showNotification(data.title || "TWM Market", {
      body: data.body || "",
      tag: data.id ? `twm-${data.id}` : undefined,
      icon: `${BASE}icons/icon-192.png`,
      badge: `${BASE}icons/badge-72.png`,
      data: { path: safePath(data.link) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.path) || "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).pathname.startsWith(BASE)) {
          await client.focus();
          client.postMessage({ type: "navigate", path });
          return;
        }
      }
      await self.clients.openWindow(`${BASE}#${path}`);
    })(),
  );
});
