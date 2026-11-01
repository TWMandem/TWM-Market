import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DEFAULT_SERVERS } from "@twm/shared";
import type { Sql } from "./client.js";

/** Папка с SQL-миграциями: apps/api/migrations. */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

// Номер блокировки, чтобы два экземпляра сервера не накатывали миграции одновременно.
const LOCK_ID = 727_274_001;

/**
 * Применяет новые SQL-файлы из migrations/ по порядку имён.
 * Всё выполняется одной транзакцией: либо применяются все новые
 * миграции, либо ни одной. Применённые записываются в schema_migrations,
 * поэтому повторный запуск ничего не ломает.
 */
export async function migrate(sql: Sql, log: (message: string) => void = () => {}): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];

  await sql.begin(async (tx) => {
    // Блокировка снимается автоматически в конце транзакции.
    await tx`SELECT pg_advisory_xact_lock(${LOCK_ID}::bigint)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;

    const rows = await tx<{ name: string }[]>`SELECT name FROM schema_migrations`;
    const done = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (done.has(file)) continue;
      const content = await readFile(`${MIGRATIONS_DIR}${file}`, "utf8");
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      applied.push(file);
      log(`Миграция применена: ${file}`);
    }

    // Стартовый список серверов. Существующие записи не трогаем:
    // их могли изменить в админ-панели.
    for (const server of DEFAULT_SERVERS) {
      await tx`
        INSERT INTO servers (number, name, color, sort_order)
        VALUES (${server.number}::smallint, ${server.name}, ${server.color}, ${server.number}::int)
        ON CONFLICT (number) DO NOTHING`;
    }
  });

  return applied;
}
