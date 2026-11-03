/**
 * Статистика ведётся по московским суткам: большинство игроков живут
 * по московскому времени. Смещение постоянное (UTC+3, без перехода на летнее).
 */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Дата по Москве в виде YYYY-MM-DD. */
export function mskDay(date: Date = new Date()): string {
  return new Date(date.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

/** Дата на `days` дней раньше указанной (YYYY-MM-DD). */
export function dayMinus(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Все даты от `from` до `to` включительно. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`).getTime();
  while (d.getTime() <= end && out.length < 1000) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
