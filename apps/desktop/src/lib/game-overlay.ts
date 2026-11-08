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
    await invoke("game_overlay_write", { text: "Войдите в Windows-приложение TWM Market, чтобы видеть объявления.\fВойдите в Windows-приложение TWM Market, чтобы видеть переписки." });
    return;
  }
  let listings: Awaited<ReturnType<typeof api.myListings>>;
  let conversations: Awaited<ReturnType<typeof api.conversations>>;
  try {
    [listings, conversations] = await Promise.all([api.myListings("active"), api.conversations()]);
  } catch {
    await invoke("game_overlay_write", {
      text: "Не удалось обновить объявления. Проверьте соединение TWM Market с сервером.\fНе удалось обновить переписки. Проверьте соединение TWM Market с сервером.",
    });
    return;
  }
  const unread = conversations.items.reduce((sum, item) => sum + item.unread, 0);
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
  const content = [
    `МОИ ОБЪЯВЛЕНИЯ · сообщений: ${unread}`,
    ...(listingLines.length ? listingLines : ["Активных объявлений нет"]),
  ].join("\n") + "\f" + chatLines.join("\n");
  await invoke("game_overlay_write", { text: content });
}

