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

/** «Был в сети»: пишем не чаще раза в минуту на игрока. */
const lastTouch = new Map<string, number>();
const TOUCH_EVERY_MS = 60 * 1000;

export async function touchLastSeen(sql: Sql, userId: string): Promise<void> {
  const now = Date.now();
  if ((lastTouch.get(userId) ?? 0) > now - TOUCH_EVERY_MS) return;
  lastTouch.set(userId, now);
  if (lastTouch.size > 50_000) lastTouch.clear();
  try {
    await sql`UPDATE users SET last_seen_at = now() WHERE id = ${userId}`;
  } catch {
    lastTouch.delete(userId);
  }
}

/** Когда игрок был в сети — если он это не скрыл. */
export function visibleLastSeen(user: { lastSeenAt: Date | null; showOnline: boolean }): string | null {
  return user.showOnline && user.lastSeenAt ? user.lastSeenAt.toISOString() : null;
}

/** Для тестов: база очищается между тестами, память — тоже. */
export function resetActivityCache(): void {
  seen.clear();
  lastTouch.clear();
}
