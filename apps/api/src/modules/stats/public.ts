import type { FastifyInstance } from "fastify";
import type { PublicStatsDto } from "@twm/shared";
import type { AppContext } from "../../context.js";
import { ownerActive, searchFrom } from "../listings/search.js";

/** Цифры для сайта меняются медленно — считаем не чаще раза в 5 минут. */
const CACHE_MS = 5 * 60 * 1000;

/**
 * Общие цифры площадки для сайта twm-market.ru: сколько сейчас объявлений
 * (всего и по разделам), сколько продавцов и подтверждённых сделок за 30 дней.
 * Без входа, без личных данных.
 */
export async function publicStatsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;
  let cached: { at: number; data: PublicStatsDto } | null = null;

  app.get("/v1/public/stats", async (_request, reply): Promise<PublicStatsDto> => {
    reply.header("Cache-Control", "public, max-age=300");
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

    const bySection = (code: string) => sections.find((s) => s.code === code)?.count ?? 0;
    const data: PublicStatsDto = {
      listings: sections.reduce((sum, s) => sum + s.count, 0),
      sections: { items: bySection("items"), cars: bySection("cars"), notary: bySection("notary") },
      sellers: totals?.sellers ?? 0,
      servers: totals?.servers ?? 0,
      dealsMonth: totals?.deals ?? 0,
      updatedAt: new Date().toISOString(),
    };
    cached = { at: Date.now(), data };
    return data;
  });
}
