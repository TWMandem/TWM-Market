import { z } from "zod";
import { LISTING_PERIODS, LISTING_SORTS, geneCounts, type AttributeDefinitionDto } from "@twm/shared";
import type { Fragment, Sql } from "../../db/client.js";
import { loadDefinitions } from "./service.js";

/**
 * Фильтр каталога. Один и тот же код ищет объявления в каталоге и проверяет,
 * подходит ли новое объявление под сохранённую подписку на поиск.
 */
export const searchQuery = z.object({
  section: z.enum(["items", "cars", "notary"]).optional(),
  type: z.coerce.number().int().positive().optional(),
  category: z.coerce.number().int().positive().optional(),
  item: z.coerce.number().int().positive().optional(),
  operation: z.enum(["sell", "buy", "exchange"]).optional(),
  server: z.coerce.number().int().positive().optional(),
  /** Показать предложения с других серверов, где возможен перевод. */
  transfer: z.enum(["1", "true"]).optional(),
  priceMin: z.coerce.number().int().min(0).optional(),
  priceMax: z.coerce.number().int().min(0).optional(),
  q: z.string().trim().max(100).optional(),
  nick: z.string().trim().max(40).optional(),
  period: z.enum(LISTING_PERIODS).optional(),
  dealPlace: z.enum(["car_market", "notary"]).optional(),
  sort: z.enum(LISTING_SORTS).default("new"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type SearchQuery = z.infer<typeof searchQuery>;

const likePattern = (text: string) => `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const PERIOD_INTERVAL = { "1d": "1 day", "7d": "7 days", "30d": "30 days" } as const;

/** Поля, по которым можно фильтровать выбранный тип имущества. */
export async function filterDefinitions(sql: Sql, typeId: number | undefined): Promise<AttributeDefinitionDto[]> {
  return typeId ? (await loadDefinitions(sql, typeId)).filter((d) => d.filterable && d.isActive) : [];
}

/** Таблицы поиска: те же псевдонимы (l, t, s, sv, gp, ci), что и у listingSelect. */
export const searchFrom = (sql: Sql) => sql`
  FROM listings l
  JOIN listing_types t ON t.id = l.listing_type_id
  JOIN sections s ON s.id = t.section_id
  JOIN servers sv ON sv.id = l.server_id
  JOIN game_profiles gp ON gp.id = l.game_profile_id
  LEFT JOIN catalog_items ci ON ci.id = l.catalog_item_id`;

export const whereOf = (sql: Sql, conditions: Fragment[]): Fragment =>
  conditions.reduce((acc, cond, i) => (i === 0 ? sql`WHERE ${cond}` : sql`${acc} AND ${cond}`), sql``);

/**
 * Условия фильтра. Фрагменты одноразовые, поэтому при каждом запросе
 * список строится заново.
 * Характеристики: a.<ключ>=значение, a.<ключ>.min / .max для чисел.
 */
export function searchConditions(
  sql: Sql,
  q: SearchQuery,
  raw: Record<string, string | undefined>,
  definitions: AttributeDefinitionDto[],
): Fragment[] {
  const c: Fragment[] = [sql`l.status = 'active'`, sql`l.expires_at > now()`, sql`s.is_active`, sql`t.is_active`];
  if (q.section) c.push(sql`s.code = ${q.section}`);
  if (q.type) c.push(sql`l.listing_type_id = ${q.type}::smallint`);
  if (q.category) {
    c.push(sql`(l.category_id = ${q.category} OR l.category_id IN (SELECT id FROM categories WHERE parent_id = ${q.category}))`);
  }
  if (q.item) c.push(sql`l.catalog_item_id = ${q.item}`);
  if (q.operation) c.push(sql`l.operation = ${q.operation}`);
  if (q.server) {
    c.push(
      q.transfer ? sql`(sv.number = ${q.server}::smallint OR l.transfer_mode <> 'none')` : sql`sv.number = ${q.server}::smallint`,
    );
  }
  if (q.priceMin !== undefined) c.push(sql`l.price >= ${q.priceMin}::bigint`);
  if (q.priceMax !== undefined) c.push(sql`l.price <= ${q.priceMax}::bigint`);
  if (q.period) c.push(sql`l.published_at > now() - ${PERIOD_INTERVAL[q.period]}::interval`);
  if (q.dealPlace) c.push(sql`${q.dealPlace} = ANY(l.deal_places)`);
  if (q.nick) c.push(sql`lower(gp.nickname) LIKE ${likePattern(q.nick)}`);
  if (q.q) {
    const like = likePattern(q.q);
    c.push(sql`(
      l.search_vector @@ websearch_to_tsquery('russian', ${q.q})
      OR lower(l.title) LIKE ${like}
      OR lower(gp.nickname) = lower(${q.q})
      OR ci.game_code = ${q.q}
      OR EXISTS (SELECT 1 FROM unnest(ci.aliases) a WHERE lower(a) LIKE ${like})
    )`);
  }
  for (const def of definitions) {
    const key = def.key;
    if (def.dataType === "number") {
      const min = Number(raw[`a.${key}.min`]);
      const max = Number(raw[`a.${key}.max`]);
      const value = () =>
        sql`(CASE WHEN jsonb_typeof(l.attributes -> ${key}) = 'number' THEN (l.attributes ->> ${key})::numeric END)`;
      if (raw[`a.${key}.min`] && Number.isFinite(min)) c.push(sql`${value()} >= ${min}::numeric`);
      if (raw[`a.${key}.max`] && Number.isFinite(max)) c.push(sql`${value()} <= ${max}::numeric`);
    } else {
      const value = raw[`a.${key}`];
      if (!value) continue;
      if (def.dataType === "genes") {
        // «YYG» — в геноме не меньше двух Y и одной G.
        const genes = () => sql`coalesce(l.attributes ->> ${key}, '')`;
        for (const [letter, count] of Object.entries(geneCounts(value, def.options))) {
          c.push(sql`(length(${genes()}) - length(replace(${genes()}, ${letter}, ''))) >= ${count}::int`);
        }
      } else if (def.dataType === "multiselect") c.push(sql`jsonb_exists(l.attributes -> ${key}, ${value})`);
      else if (def.dataType === "boolean") c.push(sql`(l.attributes ->> ${key}) = ${value === "true" ? "true" : "false"}`);
      else c.push(sql`(l.attributes ->> ${key}) = ${value}`);
    }
  }
  return c;
}

/** Разбирает сохранённые параметры поиска; null — параметры больше не подходят. */
async function parseSaved(sql: Sql, params: string) {
  const raw = Object.fromEntries(new URLSearchParams(params)) as Record<string, string | undefined>;
  const parsed = searchQuery.safeParse(raw);
  if (!parsed.success) return null;
  const definitions = await filterDefinitions(sql, parsed.data.type);
  return { conditions: () => searchConditions(sql, parsed.data, raw, definitions) };
}

/** Подходит ли объявление под фильтр (для подписок на поиск). */
export async function listingMatches(sql: Sql, listingId: string, params: string): Promise<boolean> {
  const saved = await parseSaved(sql, params);
  if (!saved) return false;
  const conditions = saved.conditions();
  conditions.push(sql`l.id = ${listingId}`);
  const [row] = await sql`SELECT 1 ${searchFrom(sql)} ${whereOf(sql, conditions)} LIMIT 1`;
  return Boolean(row);
}

/** Сколько подходящих объявлений опубликовано после указанного момента (не больше limit). */
export async function countNewMatches(sql: Sql, params: string, since: Date, limit = 100): Promise<number> {
  const saved = await parseSaved(sql, params);
  if (!saved) return 0;
  const conditions = saved.conditions();
  conditions.push(sql`l.published_at > ${since}`);
  const [row] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM (SELECT 1 ${searchFrom(sql)} ${whereOf(sql, conditions)} LIMIT ${limit}::int) x`;
  return row?.count ?? 0;
}

/** Проверка параметров перед сохранением подписки. */
export function validSearchParams(params: string): boolean {
  const raw = Object.fromEntries(new URLSearchParams(params));
  const known = new Set(Object.keys(searchQuery.shape));
  if (!Object.keys(raw).every((k) => known.has(k) || /^a\.[a-z0-9_]{1,40}(\.(min|max))?$/.test(k))) return false;
  return searchQuery.safeParse(raw).success;
}
