import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { STATS_PERIODS, type AdminMetricKey, type AdminStatsDto, type SectionCode, type StatsMetricDto } from "@twm/shared";
import type { AppContext } from "../../context.js";
import { dayMinus, dayRange, mskDay } from "../../lib/day.js";
import { requireStaff } from "../auth/guard.js";

const statsQuery = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((d): d is (typeof STATS_PERIODS)[number] => (STATS_PERIODS as readonly number[]).includes(d), "Период: 7, 30 или 90 дней")
    .default(30),
});

/** Дата по Москве из отметки времени в базе. */
const MSK = "interval '3 hours'";

export async function adminStatsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;

  // Дашборд: текущие показатели и графики за выбранный период
  // (плюс предыдущий такой же период для сравнения).
  app.get("/v1/admin/stats", { preHandler: requireStaff(ctx) }, async (request): Promise<AdminStatsDto> => {
    const { days } = statsQuery.parse(request.query);
    const today = mskDay();
    const from = dayMinus(today, days - 1);
    const prevFrom = dayMinus(today, days * 2 - 1);

    const [users] = await sql<AdminStatsDto["users"][]>`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE email_verified_at IS NOT NULL)::int AS verified,
        count(*) FILTER (WHERE status = 'blocked')::int AS blocked,
        count(*) FILTER (WHERE role <> 'user')::int AS staff
      FROM users`;
    const [extra] = await sql<{ gameProfiles: number; activeSessions: number; active: number; moderation: number }[]>`
      SELECT
        (SELECT count(*)::int FROM game_profiles WHERE archived_at IS NULL) AS game_profiles,
        (SELECT count(*)::int FROM sessions WHERE revoked_at IS NULL AND expires_at > now()) AS active_sessions,
        (SELECT count(*)::int FROM listings WHERE status = 'active' AND expires_at > now()) AS active,
        (SELECT count(*)::int FROM listings WHERE status = 'moderation') AS moderation`;
    const bySection = await sql<{ code: SectionCode; name: string; active: number }[]>`
      SELECT s.code, s.name, count(l.id)::int AS active
      FROM sections s
      LEFT JOIN listing_types t ON t.section_id = s.id
      LEFT JOIN listings l ON l.listing_type_id = t.id AND l.status = 'active' AND l.expires_at > now()
      GROUP BY s.id ORDER BY s.sort_order, s.id`;

    // Значения по дням за оба периода одним запросом на показатель.
    const rows = await sql<{ metric: AdminMetricKey; day: string; value: number }[]>`
      WITH bounds AS (SELECT ${prevFrom}::date AS from_day, ${today}::date AS to_day)
      SELECT 'registrations' AS metric, to_char((created_at AT TIME ZONE 'UTC' + ${sql.unsafe(MSK)})::date, 'YYYY-MM-DD') AS day, count(*)::int AS value
        FROM users, bounds WHERE (created_at AT TIME ZONE 'UTC' + ${sql.unsafe(MSK)})::date BETWEEN from_day AND to_day GROUP BY 2
      UNION ALL
      SELECT 'published', to_char((published_at AT TIME ZONE 'UTC' + ${sql.unsafe(MSK)})::date, 'YYYY-MM-DD'), count(*)::int
        FROM listings, bounds WHERE (published_at AT TIME ZONE 'UTC' + ${sql.unsafe(MSK)})::date BETWEEN from_day AND to_day GROUP BY 2
      UNION ALL
      SELECT 'views', to_char(day, 'YYYY-MM-DD'), sum(views)::int
        FROM listing_views_daily, bounds WHERE day BETWEEN from_day AND to_day GROUP BY day
      UNION ALL
      SELECT 'activeUsers', to_char(day, 'YYYY-MM-DD'), count(*)::int
        FROM user_activity_daily, bounds WHERE day BETWEEN from_day AND to_day GROUP BY day
      UNION ALL
      SELECT 'deals', to_char((confirmed_at AT TIME ZONE 'UTC' + ${sql.unsafe(MSK)})::date, 'YYYY-MM-DD'), count(*)::int
        FROM deals, bounds WHERE status = 'confirmed' AND (confirmed_at AT TIME ZONE 'UTC' + ${sql.unsafe(MSK)})::date BETWEEN from_day AND to_day GROUP BY 2
      UNION ALL
      SELECT 'messages', to_char((created_at AT TIME ZONE 'UTC' + ${sql.unsafe(MSK)})::date, 'YYYY-MM-DD'), count(*)::int
        FROM messages, bounds WHERE sender_id IS NOT NULL AND (created_at AT TIME ZONE 'UTC' + ${sql.unsafe(MSK)})::date BETWEEN from_day AND to_day GROUP BY 2`;

    // Активные за период — разные игроки, а не сумма по дням.
    const [distinct] = await sql<{ current: number; previous: number }[]>`
      SELECT
        count(DISTINCT user_id) FILTER (WHERE day >= ${from}::date)::int AS current,
        count(DISTINCT user_id) FILTER (WHERE day < ${from}::date)::int AS previous
      FROM user_activity_daily WHERE day BETWEEN ${prevFrom}::date AND ${today}::date`;

    const currentDays = dayRange(from, today);
    const keys: AdminMetricKey[] = ["registrations", "published", "views", "activeUsers", "deals", "messages"];
    const metrics = Object.fromEntries(
      keys.map((key): [AdminMetricKey, StatsMetricDto] => {
        const values = new Map(rows.filter((r) => r.metric === key).map((r) => [r.day, r.value]));
        let total = 0;
        let previous = 0;
        for (const [day, value] of values) {
          if (day >= from) total += value;
          else previous += value;
        }
        if (key === "activeUsers") {
          total = distinct?.current ?? 0;
          previous = distinct?.previous ?? 0;
        }
        return [key, { total, previous, byDay: currentDays.map((date) => ({ date, value: values.get(date) ?? 0 })) }];
      }),
    ) as Record<AdminMetricKey, StatsMetricDto>;

    const topCategories = await sql<AdminStatsDto["topCategories"]>`
      SELECT c.id, c.name, s.code AS section_code,
        count(DISTINCT l.id) FILTER (WHERE (l.published_at AT TIME ZONE 'UTC' + ${sql.unsafe(MSK)})::date >= ${from}::date)::int AS listings,
        COALESCE(sum(v.views), 0)::int AS views
      FROM categories c
      JOIN sections s ON s.id = c.section_id
      JOIN categories child ON child.id = c.id OR child.parent_id = c.id
      JOIN listings l ON l.category_id = child.id
      LEFT JOIN LATERAL (
        SELECT sum(views)::int AS views FROM listing_views_daily WHERE listing_id = l.id AND day >= ${from}::date
      ) v ON true
      WHERE c.parent_id IS NULL
      GROUP BY c.id, s.code
      HAVING count(DISTINCT l.id) FILTER (WHERE (l.published_at AT TIME ZONE 'UTC' + ${sql.unsafe(MSK)})::date >= ${from}::date) > 0
          OR COALESCE(sum(v.views), 0) > 0
      ORDER BY listings DESC, views DESC
      LIMIT 8`;

    const topItems = await sql<AdminStatsDto["topItems"]>`
      SELECT ci.id, ci.name, s.code AS section_code,
        count(DISTINCT l.id)::int AS listings, COALESCE(sum(v.views), 0)::int AS views
      FROM listing_views_daily v
      JOIN listings l ON l.id = v.listing_id
      JOIN catalog_items ci ON ci.id = l.catalog_item_id
      JOIN listing_types t ON t.id = l.listing_type_id
      JOIN sections s ON s.id = t.section_id
      WHERE v.day >= ${from}::date
      GROUP BY ci.id, s.code
      ORDER BY views DESC, listings DESC
      LIMIT 10`;

    return {
      days,
      users: users ?? { total: 0, verified: 0, blocked: 0, staff: 0 },
      gameProfiles: extra?.gameProfiles ?? 0,
      activeSessions: extra?.activeSessions ?? 0,
      listings: { active: extra?.active ?? 0, moderation: extra?.moderation ?? 0, bySection },
      metrics,
      topCategories,
      topItems,
    };
  });
}
