import type { Sql } from "../db/client.js";

/** Сколько дней хранятся завершённые и истёкшие сеансы (IP и устройство) — как указано в политике конфиденциальности. */
export const SESSION_KEEP_DAYS = 30;

/**
 * Удаляет старые служебные записи: сеансы, завершённые или истёкшие больше
 * SESSION_KEEP_DAYS дней назад, и использованные или истёкшие коды из писем
 * старше суток. Активные сеансы не трогаются.
 */
export async function pruneStale(sql: Sql): Promise<{ sessions: number; codes: number }> {
  const sessions = await sql`
    DELETE FROM sessions
    WHERE (revoked_at IS NOT NULL AND revoked_at < now() - make_interval(days => ${SESSION_KEEP_DAYS}::int))
       OR expires_at < now() - make_interval(days => ${SESSION_KEEP_DAYS}::int)`;
  const codes = await sql`
    DELETE FROM email_codes
    WHERE (used_at IS NOT NULL AND used_at < now() - interval '1 day') OR expires_at < now() - interval '1 day'`;
  return { sessions: sessions.count, codes: codes.count };
}
