import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuditEntryDto, Paged } from "@twm/shared";
import type { AppContext } from "../../context.js";
import { requireStaff } from "../auth/guard.js";

const query = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
  action: z.string().trim().max(60).optional(),
});

interface AuditRow {
  id: string;
  actorId: string | null;
  actorLogin: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  createdAt: Date;
}

export async function adminAuditRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;

  app.get("/v1/admin/audit", { preHandler: requireStaff(ctx, "admin") }, async (request): Promise<Paged<AuditEntryDto>> => {
    const q = query.parse(request.query);
    const filter = () => (q.action ? sql`WHERE a.action LIKE ${`${q.action.replace(/[\\%_]/g, "")}%`}` : sql``);
    const [count] = await sql<{ total: number }[]>`SELECT count(*)::int AS total FROM audit_log a ${filter()}`;
    const rows = await sql<AuditRow[]>`
      SELECT a.id, a.actor_id, u.login AS actor_login, a.action, a.target_type, a.target_id, a.details, a.ip, a.created_at
      FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      ${filter()}
      ORDER BY a.id DESC
      LIMIT ${q.pageSize}::int OFFSET ${(q.page - 1) * q.pageSize}::int`;
    return {
      items: rows.map((r) => ({
        id: Number(r.id),
        actor: r.actorId ? { id: r.actorId, login: r.actorLogin ?? "?" } : null,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        details: r.details,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
      })),
      total: count?.total ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  });
}
