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
    await invoke("game_overlay_write", { text: "Войдите в TWM Market\fНет выбранной договорённости" });
    return;
  }
  const [listings, conversations] = await Promise.all([api.myListings("active"), api.conversations()]);
  const unread = conversations.items.reduce((sum, item) => sum + item.unread, 0);
  const listingLines = listings.items.slice(0, 12).map((item) =>
    `${line(item.title)} — ${price(item.price)} · ${line(item.server.name)}`,
  );
  const meeting = conversations.items.find((item: ConversationDto) =>
    item.blocked === null && item.deal?.status !== "confirmed" && item.agreedPrice !== null,
  );
  const meetingLines = meeting ? [
    line(meeting.listing.title),
    `Собеседник: ${line(meeting.counterpart.nickname ?? meeting.counterpart.login)}`,
    `Сервер: ${line(meeting.listing.server.name)}`,
    `Цена: ${price(meeting.agreedPrice ?? meeting.listing.price)}`,
    `Непрочитанных сообщений: ${meeting.unread}`,
  ] : ["Согласованной цены пока нет. Откройте переписку в TWM Market."];
  const content = [
    `МОИ ОБЪЯВЛЕНИЯ · сообщений: ${unread}`,
    ...(listingLines.length ? listingLines : ["Активных объявлений нет"]),
  ].join("\n") + "\f" + meetingLines.join("\n");
  await invoke("game_overlay_write", { text: content });
}

