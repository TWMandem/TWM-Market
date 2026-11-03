import type { Sql } from "../db/client.js";
import { mskDay } from "./day.js";

/**
 * Отметка «игрок заходил сегодня» для графика активных пользователей.
 * В базу пишется один раз в сутки на пользователя: уже отмеченные
 * держим в памяти и сбрасываем при смене дня.
 */
let currentDay = "";
const seen = new Set<string>();

export async function trackActivity(sql: Sql, userId: string): Promise<void> {
  const day = mskDay();
  if (day !== currentDay) {
    currentDay = day;
    seen.clear();
  }
  if (seen.has(userId)) return;
  seen.add(userId);
  try {
    await sql`INSERT INTO user_activity_daily (user_id, day) VALUES (${userId}, ${day}::date) ON CONFLICT DO NOTHING`;
  } catch {
    // Статистика не должна мешать работе: при ошибке попробуем в следующий раз.
    seen.delete(userId);
  }
}

/** Для тестов: база очищается между тестами, память — тоже. */
export function resetActivityCache(): void {
  seen.clear();
}
