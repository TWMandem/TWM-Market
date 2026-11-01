import type { NotificationKind } from "@twm/shared";
import type { Sql } from "../db/client.js";

/**
 * Уведомление пользователю. Приложение забирает их при опросе
 * и показывает во всплывающем окне Windows.
 */
export async function notify(
  sql: Sql,
  userId: string,
  kind: NotificationKind,
  title: string,
  body = "",
  link: string | null = null,
): Promise<void> {
  await sql`
    INSERT INTO notifications (user_id, kind, title, body, link)
    VALUES (${userId}, ${kind}, ${title.slice(0, 120)}, ${body.slice(0, 300)}, ${link})`;
}
