import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clientErrorSchema, type AppErrorGroupDto } from "@twm/shared";
import type { AppContext } from "../../context.js";
import { logError } from "../../lib/error-log.js";
import { parseBody } from "../../lib/errors.js";
import { optionalAuth, requireStaff } from "../auth/guard.js";

const listQuery = z.object({
  days: z.coerce.number().int().min(1).max(30).default(7),
  source: z.enum(["app", "server"]).optional(),
});

export async function errorRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;

  // Приложение присылает свои сбои. Без личных данных: текст, стек, экран, версия.
  app.post(
    "/v1/client-errors",
    { preHandler: optionalAuth(ctx), config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const input = parseBody(clientErrorSchema, request.body);
      await logError(sql, {
        source: "app",
        message: input.message,
        stack: input.stack,
        route: input.route,
        appVersion: input.version,
        userId: request.auth?.user.id ?? null,
      });
      return reply.code(204).send();
    },
  );

  // Ошибки за период, сгруппированные: сколько раз, у скольких игроков, когда последний раз.
  app.get("/v1/admin/errors", { preHandler: requireStaff(ctx, "admin") }, async (request): Promise<{ items: AppErrorGroupDto[] }> => {
    const q = listQuery.parse(request.query);
    const rows = await sql<
      { fingerprint: string; source: "app" | "server"; message: string; count: number; users: number; firstAt: Date; lastAt: Date; stack: string; route: string; versions: string[] }[]
    >`
      SELECT e.fingerprint, min(e.source) AS source, count(*)::int AS count, count(DISTINCT e.user_id)::int AS users,
        min(e.created_at) AS first_at, max(e.created_at) AS last_at,
        array_remove(array_agg(DISTINCT e.app_version), '') AS versions,
        (array_agg(e.message ORDER BY e.created_at DESC))[1] AS message,
        (array_agg(e.stack ORDER BY e.created_at DESC))[1] AS stack,
        (array_agg(e.route ORDER BY e.created_at DESC))[1] AS route
      FROM app_errors e
      WHERE e.created_at > now() - make_interval(days => ${q.days}::int)
        ${q.source ? sql`AND e.source = ${q.source}` : sql``}
      GROUP BY e.fingerprint
      ORDER BY max(e.created_at) DESC
      LIMIT 200`;
    return {
      items: rows.map((r) => ({
        fingerprint: r.fingerprint,
        source: r.source,
        message: r.message,
        stack: r.stack,
        route: r.route,
        count: r.count,
        users: r.users,
        versions: r.versions,
        firstAt: r.firstAt.toISOString(),
        lastAt: r.lastAt.toISOString(),
      })),
    };
  });
}
