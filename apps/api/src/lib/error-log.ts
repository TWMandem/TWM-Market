import { createHash } from "node:crypto";
import type { Sql } from "../db/client.js";

/**
 * Журнал ошибок: из приложения игроков и внутренние ошибки сервера.
 * Одинаковые ошибки группируются по отпечатку. Хранится 30 дней.
 */

export const ERROR_KEEP_DAYS = 30;

export interface ErrorRecord {
  source: "app" | "server";
  message: string;
  stack?: string;
  route?: string;
  appVersion?: string;
  userId?: string | null;
}

/** Номера, адреса и идентификаторы в тексте мешают группировке — заменяем их. */
function normalize(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\d+/g, "<n>")
    .slice(0, 300);
}

export function fingerprint(record: Pick<ErrorRecord, "source" | "message" | "stack">): string {
  const firstFrame = (record.stack ?? "").split("\n").find((line) => line.trim().startsWith("at ")) ?? "";
  return createHash("sha1").update(`${record.source}|${normalize(record.message)}|${normalize(firstFrame.trim())}`).digest("hex");
}

export async function logError(sql: Sql, record: ErrorRecord): Promise<void> {
  await sql`
    INSERT INTO app_errors (source, fingerprint, message, stack, route, app_version, user_id)
    VALUES (
      ${record.source}, ${fingerprint(record)}, ${record.message.slice(0, 500)}, ${(record.stack ?? "").slice(0, 4000)},
      ${(record.route ?? "").slice(0, 200)}, ${(record.appVersion ?? "").slice(0, 20)}, ${record.userId ?? null}
    )`;
}

export async function pruneErrors(sql: Sql): Promise<number> {
  const result = await sql`DELETE FROM app_errors WHERE created_at < now() - make_interval(days => ${ERROR_KEEP_DAYS}::int)`;
  return result.count;
}
