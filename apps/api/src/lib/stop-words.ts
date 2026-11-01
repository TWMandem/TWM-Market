import { findStopWord } from "@twm/shared";
import type { Sql } from "../db/client.js";

interface StopWordRow {
  id: number;
  phrase: string;
  isRegex: boolean;
  note: string | null;
}

/**
 * Стоп-слова читаются из базы и держатся в памяти полминуты:
 * проверка идёт при каждом сообщении, а список меняется редко.
 */
let cache: { at: number; words: StopWordRow[] } | null = null;
const TTL_MS = 30_000;

export function resetStopWordCache(): void {
  cache = null;
}

async function load(sql: Sql): Promise<StopWordRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.words;
  const words = await sql<StopWordRow[]>`SELECT id, phrase, is_regex, note FROM stop_words ORDER BY id`;
  cache = { at: Date.now(), words: [...words] };
  return cache.words;
}

/** Причина для модерации, если в тексте нашлось стоп-слово, иначе null. */
export async function stopWordReason(sql: Sql, ...texts: string[]): Promise<string | null> {
  const words = await load(sql);
  const hit = findStopWord(texts.filter(Boolean).join("\n"), words);
  if (!hit) return null;
  const what = hit.isRegex ? hit.note ?? "подозрительный текст" : `«${hit.phrase}»`;
  return `Стоп-слово: ${what}`;
}
