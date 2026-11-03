import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AdminUserActivityDto } from "@twm/shared";
import type { AppContext } from "../../context.js";
import { errors } from "../../lib/errors.js";
import { requireStaff } from "../auth/guard.js";

const idParam = z.object({ id: z.string().uuid() });

/**
 * История игрока для модератора: объявления, жалобы на него и от него,
 * полученные отзывы, решения модераторов. Только чтение.
 */
export async function adminActivityRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;

  app.get("/v1/admin/users/:id/activity", { preHandler: requireStaff(ctx) }, async (request): Promise<AdminUserActivityDto> => {
    const params = idParam.safeParse(request.params);
    if (!params.success) throw errors.notFound("Пользователь не найден");
    const id = params.data.id;
    const [user] = await sql<{ lastSeenAt: Date | null }[]>`SELECT last_seen_at FROM users WHERE id = ${id}`;
    if (!user) throw errors.notFound("Пользователь не найден");

    // Жалобы на игрока: на него самого, его объявления, сообщения и отзывы.
    const against = () => sql`(
      (r.target_type = 'user' AND r.target_id = ${id}::text)
      OR (r.target_type = 'listing' AND r.target_id IN (SELECT l.id::text FROM listings l WHERE l.user_id = ${id}))
      OR (r.target_type = 'message' AND r.target_id IN (SELECT m.id::text FROM messages m WHERE m.sender_id = ${id}))
      OR (r.target_type = 'review' AND r.target_id IN (SELECT v.id::text FROM reviews v WHERE v.author_id = ${id}))
    )`;

    const listingCounts = await sql<{ status: string; count: number }[]>`
      SELECT status, count(*)::int AS count FROM listings WHERE user_id = ${id} GROUP BY status`;
    const [stats] = await sql<
      { deals: number; positive: number; negative: number; hidden: number; reportsOpen: number; reportsTotal: number; reportsFiled: number; blockedBy: number }[]
    >`
      SELECT
        (SELECT count(*)::int FROM deals WHERE (buyer_id = ${id} OR seller_id = ${id}) AND status = 'confirmed') AS deals,
        (SELECT count(*)::int FROM reviews WHERE target_id = ${id} AND positive AND hidden_at IS NULL) AS positive,
        (SELECT count(*)::int FROM reviews WHERE target_id = ${id} AND NOT positive AND hidden_at IS NULL) AS negative,
        (SELECT count(*)::int FROM reviews WHERE target_id = ${id} AND hidden_at IS NOT NULL) AS hidden,
        (SELECT count(*)::int FROM reports r WHERE ${against()} AND r.status = 'open') AS reports_open,
        (SELECT count(*)::int FROM reports r WHERE ${against()}) AS reports_total,
        (SELECT count(*)::int FROM reports WHERE author_id = ${id}) AS reports_filed,
        (SELECT count(*)::int FROM user_blocks WHERE blocked_id = ${id}) AS blocked_by`;

    const listings = await sql<{ id: string; title: string; status: AdminUserActivityDto["listings"][number]["status"]; price: string | null; updatedAt: Date }[]>`
      SELECT id, title, status, price, updated_at FROM listings WHERE user_id = ${id} ORDER BY updated_at DESC LIMIT 30`;
    const reports = await sql<
      { id: string; targetType: AdminUserActivityDto["reportsAgainst"][number]["targetType"]; reason: AdminUserActivityDto["reportsAgainst"][number]["reason"]; comment: string; status: "open" | "resolved" | "dismissed"; author: string | null; createdAt: Date }[]
    >`
      SELECT r.id, r.target_type, r.reason, r.comment, r.status, a.login AS author, r.created_at
      FROM reports r LEFT JOIN users a ON a.id = r.author_id
      WHERE ${against()}
      ORDER BY r.created_at DESC LIMIT 30`;
    const reviews = await sql<{ id: string; positive: boolean; comment: string; author: string; hiddenAt: Date | null; createdAt: Date }[]>`
      SELECT v.id, v.positive, v.comment, a.login AS author, v.hidden_at, v.created_at
      FROM reviews v JOIN users a ON a.id = v.author_id
      WHERE v.target_id = ${id} ORDER BY v.created_at DESC LIMIT 30`;
    const audit = await sql<{ action: string; actor: string | null; createdAt: Date; details: Record<string, unknown> }[]>`
      SELECT a.action, u.login AS actor, a.created_at, a.details
      FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE (a.target_type = 'user' AND a.target_id = ${id}::text)
         OR (a.target_type = 'listing' AND a.target_id IN (SELECT l.id::text FROM listings l WHERE l.user_id = ${id}))
         OR (a.target_type = 'game_profile' AND a.target_id IN (SELECT p.id::text FROM game_profiles p WHERE p.user_id = ${id}))
      ORDER BY a.created_at DESC LIMIT 30`;

    return {
      stats: {
        listings: Object.fromEntries(listingCounts.map((c) => [c.status, c.count])),
        deals: stats?.deals ?? 0,
        reviewsReceived: { positive: stats?.positive ?? 0, negative: stats?.negative ?? 0, hidden: stats?.hidden ?? 0 },
        reportsAgainst: { open: stats?.reportsOpen ?? 0, total: stats?.reportsTotal ?? 0 },
        reportsFiled: stats?.reportsFiled ?? 0,
        blockedBy: stats?.blockedBy ?? 0,
        lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
      },
      listings: listings.map((l) => ({ id: l.id, title: l.title, status: l.status, price: l.price === null ? null : Number(l.price), updatedAt: l.updatedAt.toISOString() })),
      reportsAgainst: reports.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      reviews: reviews.map((v) => ({ id: v.id, positive: v.positive, comment: v.comment, author: v.author, hidden: v.hiddenAt !== null, createdAt: v.createdAt.toISOString() })),
      audit: audit.map((a) => ({ action: a.action, actor: a.actor, createdAt: a.createdAt.toISOString(), details: a.details })),
    };
  });
}
