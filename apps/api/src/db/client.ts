import postgres from "postgres";

/**
 * Подключение к PostgreSQL через postgres.js.
 * Запросы пишутся на SQL с параметрами (`${value}` в шаблоне никогда
 * не вклеивается в текст запроса, поэтому SQL-инъекции исключены).
 * Имена колонок в ответах автоматически переводятся в camelCase.
 */
export type Sql = postgres.Sql;

export interface Database {
  sql: Sql;
  close: () => Promise<void>;
}

export function createDatabase(url: string, options: { max?: number } = {}): Database {
  const sql: Sql = postgres(url, {
    max: options.max ?? 10,
    transform: postgres.camel,
    onnotice: () => {},
  });
  return { sql, close: () => sql.end({ timeout: 5 }) };
}

/** Нарушение уникальности: возвращает имя ограничения или null. */
export function uniqueViolation(error: unknown): string | null {
  const e = error as { code?: string; constraint_name?: string } | null;
  if (e && e.code === "23505") return e.constraint_name ?? "";
  return null;
}
