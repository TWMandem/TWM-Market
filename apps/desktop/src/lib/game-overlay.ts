import { invoke } from "@tauri-apps/api/core";
import type { ConversationDto } from "@twm/shared";
import { api } from "./api";
import { isTauri } from "./token-store";

const line = (value: string) => value.replace(/[\r\n\f\t]/g, " ").trim().slice(0, 120);
const price = (value: number | null) => value === null ? "Цена договорная" : `${value.toLocaleString("ru-RU")} ₽`;

/** Передаёт плагину только отображаемые сведения; токены остаются в TWM Market. */
export async function updateGameOverlay(authenticated: boolean): Promise<void> {
  if (!isTauri() || /android/i.test(navigator.userAgent)) return;
  if (!authenticated) {
    const guest = "Войдите в Windows-приложение TWM Market, чтобы увидеть данные аккаунта.";
    await invoke("game_overlay_write", { text: [guest, guest, guest, guest, guest].join("\f") });
    return;
  }
  let listings: Awaited<ReturnType<typeof api.myListings>>;
  let conversations: Awaited<ReturnType<typeof api.conversations>>;
  let favorites: Awaited<ReturnType<typeof api.favorites>>;
  let notifications: Awaited<ReturnType<typeof api.notifications>>;
  try {
    [listings, conversations, favorites, notifications] = await Promise.all([
      api.myListings("active"), api.conversations(), api.favorites(), api.notifications(),
    ]);
  } catch {
    const failed = "Не удалось обновить данные. Проверьте соединение TWM Market с сервером.";
    await invoke("game_overlay_write", {
      text: [failed, failed, failed, failed, failed].join("\f"),
    });
    return;
  }
  const unread = conversations.items.reduce((sum, item) => sum + item.unread, 0);
  const unreadNotifications = notifications.items.filter((item) => !item.read).length;
  const listingFavorites = listings.items.reduce((sum, item) => sum + item.favorites, 0);
  const listingLines = listings.items.slice(0, 12).map((item) =>
    `${line(item.title)} — ${price(item.price)} · ${line(item.server.name)}`,
  );
  const chats = conversations.items
    .filter((item: ConversationDto) => item.blocked === null && item.deal?.status !== "confirmed")
    .slice(0, 3);
  const chatLines = chats.length ? chats.flatMap((item: ConversationDto) => [
    `${line(item.listing.title)} · ${line(item.counterpart.nickname ?? item.counterpart.login)}`,
    `${line(item.listing.server.name)} · ${price(item.agreedPrice ?? item.listing.price)}${item.agreedPrice !== null ? " (согласовано)" : ""} · новых: ${item.unread}`,
    "",
  ]) : ["Активных переписок нет. Место и время встречи обсудите в чате TWM Market."];
  const favoriteLines = favorites.items.slice(0, 7).map((item) =>
    `${line(item.title)} — ${price(item.price)} · ${line(item.server.name)}`,
  );
  const notificationLines = notifications.items.slice(0, 7).map((item) =>
    `${item.read ? "○" : "●"} ${line(item.title)} — ${line(item.body)}`,
  );
  const overview = [
    "Рынок под рукой, не выходя из игры",
    "",
    `Активные объявления: ${listings.items.length}`,
    `Добавили ваши объявления в избранное: ${listingFavorites}`,
    `Непрочитанные сообщения: ${unread}`,
    `Новые уведомления: ${unreadNotifications}`,
    `В избранном: ${favorites.items.length}`,
  ];
  const content = [
    overview.join("\n"),
    (listingLines.length ? listingLines : ["Активных объявлений нет"]).join("\n"),
    chatLines.join("\n"),
    (favoriteLines.length ? favoriteLines : ["В избранном пока ничего нет"]).join("\n"),
    (notificationLines.length ? notificationLines : ["Уведомлений пока нет"]).join("\n"),
  ].join("\f");
  await invoke("game_overlay_write", { text: content });
}

