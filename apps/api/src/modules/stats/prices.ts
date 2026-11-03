import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PRICE_HISTORY_DAYS, type PriceHistoryDays, type PriceHistoryDto, type ServerRefDto } from "@twm/shared";
import type { AppContext } from "../../context.js";
import type { Sql } from "../../db/client.js";
import { errors } from "../../lib/errors.js";
import { dayMinus, mskDay } from "../../lib/day.js";

/**
 * Снимок цен: по каждому предмету или модели и серверу — сколько сейчас
 * предложений о продаже и по какой цене. Запускается раз в час; за день
 * хранится последний снимок. Из снимков строится график «история цены».
 */
export async function snapshotPrices(sql: Sql): Promise<number> {
  const rows = await sql`
    INSERT INTO price_snapshots (catalog_item_id, server_id, day, offers, median, average, min, max)
    SELECT catalog_item_id, server_id, ${mskDay()}::date, count(*)::int,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price))::bigint,
      round(avg(price))::bigint, min(price), max(price)
    FROM listings
    WHERE catalog_item_id IS NOT NULL AND operation = 'sell' AND status = 'active'
      AND expires_at > now() AND price IS NOT NULL
    GROUP BY catalog_item_id, server_id
    ON CONFLICT (catalog_item_id, server_id, day) DO UPDATE SET
      offers = EXCLUDED.offers, median = EXCLUDED.median, average = EXCLUDED.average,
      min = EXCLUDED.min, max = EXCLUDED.max
    RETURNING 1`;
  return rows.length;
}

const pricesQuery = z.object({
  server: z.coerce.number().int().positive().optional(),
  days: z.coerce
    .number()
    .int()
    .refine((d): d is PriceHistoryDays => (PRICE_HISTORY_DAYS as readonly number[]).includes(d), "Период: 30, 90 или 365 дней")
    .default(90),
});

const num = (v: string | null): number | null => (v === null ? null : Number(v));

export async function priceRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;

  // История цены предмета или модели: на одном сервере или по всем.
  app.get("/v1/catalog/items/:id/prices", async (request): Promise<PriceHistoryDto> => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(request.params);
    if (!params.success) throw errors.notFound("Предмет не найден");
    const q = pricesQuery.parse(request.query);

    const [item] = await sql<{ id: number; name: string }[]>`
      SELECT id, name FROM catalog_items WHERE id = ${params.data.id} AND is_active`;
    if (!item) throw errors.notFound("Предмет не найден");

    let server: (ServerRefDto & { id: number }) | null = null;
    if (q.server) {
      const [row] = await sql<(ServerRefDto & { id: number })[]>`
        SELECT id, number, name, color FROM servers WHERE number = ${q.server}::smallint`;
      if (!row) throw errors.notFound("Сервер не найден");
      server = row;
    }
    const serverId = server?.id ?? null;
    const from = dayMinus(mskDay(), q.days - 1);

    const [current] = await sql<{ count: number; average: string; median: string; min: string; max: string }[]>`
      SELECT count(*)::int AS count, round(avg(price))::bigint AS average,
        round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price))::bigint AS median,
        min(price) AS min, max(price) AS max
      FROM listings
      WHERE catalog_item_id = ${item.id} AND operation = 'sell' AND status = 'active'
        AND expires_at > now() AND price IS NOT NULL
        ${serverId !== null ? sql`AND server_id = ${serverId}` : sql``}`;

    // По всем серверам медиану из снимков не сложить — показываем среднюю.
    const history = await sql<
      { date: string; offers: number; median: string | null; average: string; min: string; max: string }[]
    >`
      SELECT to_char(day, 'YYYY-MM-DD') AS date, sum(offers)::int AS offers,
        ${serverId !== null ? sql`max(median)` : sql`NULL::bigint`} AS median,
        round(sum(average * offers)::numeric / sum(offers))::bigint AS average,
        min(min) AS min, max(max) AS max
      FROM price_snapshots
      WHERE catalog_item_id = ${item.id} AND day >= ${from}::date
        ${serverId !== null ? sql`AND server_id = ${serverId}` : sql``}
      GROUP BY day ORDER BY day`;

    const deals = await sql<
      { price: string; confirmedAt: Date; operation: "sell" | "buy"; serverNumber: number; serverName: string; serverColor: string }[]
    >`
      SELECT l.price, d.confirmed_at, l.operation, sv.number AS server_number, sv.name AS server_name, sv.color AS server_color
      FROM deals d
      JOIN listings l ON l.id = d.listing_id
      JOIN servers sv ON sv.id = l.server_id
      WHERE l.catalog_item_id = ${item.id} AND d.status = 'confirmed' AND l.price IS NOT NULL
        AND l.operation IN ('sell', 'buy')
        AND d.confirmed_at > now() - make_interval(days => ${q.days}::int)
        ${serverId !== null ? sql`AND l.server_id = ${serverId}` : sql``}
      ORDER BY d.confirmed_at DESC
      LIMIT 200`;
    const dealSum = deals.reduce((sum, d) => sum + Number(d.price), 0);

    return {
      item,
      server: server ? { number: server.number, name: server.name, color: server.color } : null,
      days: q.days,
      current:
        current && current.count > 0
          ? {
              count: current.count,
              average: Number(current.average),
              median: Number(current.median),
              min: Number(current.min),
              max: Number(current.max),
            }
          : null,
      history: history.map((h) => ({
        date: h.date,
        offers: h.offers,
        median: num(h.median),
        average: Number(h.average),
        min: Number(h.min),
        max: Number(h.max),
      })),
      deals: {
        count: deals.length,
        average: deals.length ? Math.round(dealSum / deals.length) : null,
        recent: deals.slice(0, 10).map((d) => ({
          price: Number(d.price),
          date: d.confirmedAt.toISOString(),
          operation: d.operation,
          server: { number: d.serverNumber, name: d.serverName, color: d.serverColor },
        })),
      },
    };
  });
}
