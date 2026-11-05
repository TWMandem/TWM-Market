import type { NotificationKind } from "@twm/shared";
import type { Sql } from "../db/client.js";
import { sendWebPush } from "./web-push.js";

/**
 * Уведомление пользователю. Приложение забирает их при опросе и показывает
 * во всплывающем окне Windows или уведомлением Android; веб-приложению
 * (iPhone) оно сразу уходит через Web Push.
 */
export async function notify(
  sql: Sql,
  userId: string,
  kind: NotificationKind,
  title: string,
  body = "",
  link: string | null = null,
): Promise<void> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO notifications (user_id, kind, title, body, link)
    VALUES (${userId}, ${kind}, ${title.slice(0, 120)}, ${body.slice(0, 300)}, ${link})
    RETURNING id`;
  // Без ожидания: ответ API не ждёт служб уведомлений браузеров.
  if (row) void sendWebPush(sql, userId, { id: Number(row.id), title, body, link });
}
