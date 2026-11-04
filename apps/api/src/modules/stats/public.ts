import type { FastifyInstance } from "fastify";
import type { PublicStatsDto, PublicTickerItemDto } from "@twm/shared";
import type { AppContext } from "../../context.js";
import { ownerActive, searchFrom } from "../listings/search.js";

/** Табло на сайте обновляется раз в минуту — чаще считать незачем. */
const CACHE_MS = 60 * 1000;
/** Сколько свежих объявлений отдавать для табло. */
const TICKER_SIZE = 16;

/**
 * Общие цифры площадки для сайта twm-market.ru: сколько сейчас объявлений
 * (всего и по разделам), сколько продавцов и подтверждённых сделок за 30 дней,
 * и свежие объявления для табло на главной. Без входа, без ников и логинов.
 */
export async function publicStatsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;
  let cached: { at: number; data: PublicStatsDto } | null = null;

  app.get("/v1/public/stats", async (_request, reply): Promise<PublicStatsDto> => {
    reply.header("Cache-Control", "public, max-age=60");
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;

    const sections = await sql<{ code: string; count: number }[]>`
      SELECT s.code, count(*)::int AS count
      ${searchFrom(sql)}
      WHERE l.status = 'active' AND l.expires_at > now() AND s.is_active AND t.is_active AND sv.is_active AND ${ownerActive(sql)}
      GROUP BY s.code`;
    const [totals] = await sql<{ sellers: number; servers: number; deals: number }[]>`
      SELECT
        (SELECT count(DISTINCT l.user_id)::int FROM listings l
          WHERE l.status = 'active' AND l.expires_at > now() AND ${ownerActive(sql)}) AS sellers,
        (SELECT count(*)::int FROM servers WHERE is_active) AS servers,
        (SELECT count(*)::int FROM deals WHERE status = 'confirmed' AND confirmed_at > now() - interval '30 days') AS deals`;

    const latest = await sql<{ title: string; price: string | null; operation: PublicTickerItemDto["operation"]; section: string; serverName: string; serverColor: string; at: Date | null }[]>`
      SELECT l.title, l.price, l.operation, s.code AS section, sv.name AS server_name, sv.color AS server_color,
             COALESCE(l.bumped_at, l.published_at) AS at
      ${searchFrom(sql)}
      WHERE l.status = 'active' AND l.expires_at > now() AND s.is_active AND t.is_active AND sv.is_active AND ${ownerActive(sql)}
      ORDER BY COALESCE(l.bumped_at, l.published_at) DESC NULLS LAST
      LIMIT ${TICKER_SIZE}::int`;

    const bySection = (code: string) => sections.find((s) => s.code === code)?.count ?? 0;
    const data: PublicStatsDto = {
      listings: sections.reduce((sum, s) => sum + s.count, 0),
      sections: { items: bySection("items"), cars: bySection("cars"), notary: bySection("notary") },
      sellers: totals?.sellers ?? 0,
      servers: totals?.servers ?? 0,
      dealsMonth: totals?.deals ?? 0,
      latest: latest.map((l) => ({
        title: l.title,
        price: l.price === null ? null : Number(l.price),
        operation: l.operation,
        section: l.section as PublicTickerItemDto["section"],
        server: { name: l.serverName, color: l.serverColor },
        at: (l.at ?? new Date()).toISOString(),
      })),
      updatedAt: new Date().toISOString(),
    };
    cached = { at: Date.now(), data };
    return data;
  });
}
