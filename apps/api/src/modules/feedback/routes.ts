import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  FEEDBACK_STATUSES,
  feedbackCreateSchema,
  feedbackUpdateSchema,
  type FeedbackCategory,
  type FeedbackDto,
  type FeedbackStatus,
} from "@twm/shared";
import type { AppContext } from "../../context.js";
import { writeAudit } from "../../lib/audit.js";
import { errors, parseBody } from "../../lib/errors.js";
import { notify } from "../../lib/notify.js";
import { authOf, requireAuth, requireStaff } from "../auth/guard.js";

interface FeedbackRow {
  id: string;
  authorId: string | null;
  authorLogin: string | null;
  category: FeedbackCategory;
  title: string;
  description: string;
  status: FeedbackStatus;
  response: string;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt: Date | null;
}

const toDto = (row: FeedbackRow): FeedbackDto => ({
  id: row.id,
  category: row.category,
  title: row.title,
  description: row.description,
  status: row.status,
  response: row.response,
  author: row.authorId ? { id: row.authorId, login: row.authorLogin ?? "?" } : null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  reviewedAt: row.reviewedAt?.toISOString() ?? null,
});

const fields = `
  f.id, f.author_id, u.login AS author_login, f.category, f.title, f.description,
  f.status, f.response, f.created_at, f.updated_at, f.reviewed_at`;

/** Предложения игроков: отправка, история пользователя и очередь администратора. */
export async function feedbackRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;
  const auth = requireAuth(ctx);

  app.post(
    "/v1/feedback",
    { preHandler: auth, config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (request, reply): Promise<FeedbackDto> => {
      const { user } = authOf(request);
      const input = parseBody(feedbackCreateSchema, request.body);
      const [row] = await sql<FeedbackRow[]>`
        INSERT INTO feedback (author_id, category, title, description)
        VALUES (${user.id}, ${input.category}, ${input.title}, ${input.description})
        RETURNING id, author_id, ${user.login}::text AS author_login, category, title, description,
          status, response, created_at, updated_at, reviewed_at`;
      if (!row) throw new Error("Предложение не сохранилось");
      reply.code(201);
      return toDto(row);
    },
  );

  app.get("/v1/me/feedback", { preHandler: auth }, async (request): Promise<{ items: FeedbackDto[] }> => {
    const { user } = authOf(request);
    const rows = await sql<FeedbackRow[]>`
      SELECT ${sql.unsafe(fields)} FROM feedback f LEFT JOIN users u ON u.id = f.author_id
      WHERE f.author_id = ${user.id}
      ORDER BY f.created_at DESC LIMIT 50`;
    return { items: rows.map(toDto) };
  });

  app.get("/v1/admin/feedback", { preHandler: requireStaff(ctx, "admin") }, async (request): Promise<{ items: FeedbackDto[] }> => {
    const query = z.object({ status: z.enum(FEEDBACK_STATUSES).optional() }).parse(request.query);
    const rows = await sql<FeedbackRow[]>`
      SELECT ${sql.unsafe(fields)} FROM feedback f LEFT JOIN users u ON u.id = f.author_id
      ${query.status ? sql`WHERE f.status = ${query.status}` : sql``}
      ORDER BY CASE WHEN f.status = 'new' THEN 0 ELSE 1 END, f.updated_at DESC
      LIMIT 300`;
    return { items: rows.map(toDto) };
  });

  app.patch("/v1/admin/feedback/:id", { preHandler: requireStaff(ctx, "admin") }, async (request): Promise<FeedbackDto> => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = parseBody(feedbackUpdateSchema, request.body);
    const [row] = await sql<FeedbackRow[]>`
      WITH changed AS (
        UPDATE feedback SET status = ${input.status}, response = ${input.response},
          reviewed_by = ${authOf(request).user.id}, reviewed_at = now(), updated_at = now()
        WHERE id = ${id}
        RETURNING *
      )
      SELECT ${sql.unsafe(fields)} FROM changed f LEFT JOIN users u ON u.id = f.author_id`;
    if (!row) throw errors.notFound("Предложение не найдено");
    await writeAudit(ctx, request, "feedback.updated", { type: "feedback", id }, { status: input.status });
    if (row.authorId) {
      await notify(sql, row.authorId, "feedback_updated", "Статус предложения изменён", row.title, "/feedback");
    }
    return toDto(row);
  });
}

