import type { FastifyInstance } from "fastify";
import { REPORTS_TO_HIDE, reportSchema } from "@twm/shared";
import type { AppContext } from "../../context.js";
import { errors, parseBody } from "../../lib/errors.js";
import { notify } from "../../lib/notify.js";
import { authOf, requireAuth } from "../auth/guard.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Жалобы игроков. Объявление, на которое пожаловались несколько разных
 * игроков, скрывается до решения модератора.
 */
export async function reportRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;
  const auth = requireAuth(ctx);

  app.post(
    "/v1/reports",
    { preHandler: auth, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const { user } = authOf(request);
      const input = parseBody(reportSchema, request.body);
      let targetId = input.targetId;
      const notFound = () => errors.notFound("Объект жалобы не найден");

      // Жалоба только на то, что игрок может видеть, и не на самого себя.
      switch (input.targetType) {
        case "listing": {
          if (!UUID.test(targetId)) throw notFound();
          const [listing] = await sql<{ userId: string; status: string }[]>`
            SELECT user_id, status FROM listings WHERE id = ${targetId}`;
          if (!listing || listing.status === "draft") throw notFound();
          if (listing.userId === user.id) throw errors.conflict("own_target", "Нельзя пожаловаться на своё объявление");
          break;
        }
        case "message": {
          if (!UUID.test(targetId)) throw notFound();
          const [message] = await sql<{ senderId: string | null }[]>`
            SELECT m.sender_id FROM messages m JOIN conversations c ON c.id = m.conversation_id
            WHERE m.id = ${targetId} AND (c.buyer_id = ${user.id} OR c.seller_id = ${user.id})`;
          if (!message || message.senderId === null) throw notFound();
          if (message.senderId === user.id) throw errors.conflict("own_target", "Нельзя пожаловаться на своё сообщение");
          break;
        }
        case "review": {
          if (!UUID.test(targetId)) throw notFound();
          const [review] = await sql<{ authorId: string }[]>`SELECT author_id FROM reviews WHERE id = ${targetId}`;
          if (!review) throw notFound();
          if (review.authorId === user.id) throw errors.conflict("own_target", "Нельзя пожаловаться на свой отзыв");
          break;
        }
        case "user": {
          // Игрока указывают по логину, хранится его id.
          const [target] = await sql<{ id: string }[]>`SELECT id FROM users WHERE lower(login) = lower(${targetId})`;
          if (!target) throw notFound();
          if (target.id === user.id) throw errors.conflict("own_target", "Нельзя пожаловаться на себя");
          targetId = target.id;
          break;
        }
      }

      const [created] = await sql<{ id: string }[]>`
        INSERT INTO reports (author_id, target_type, target_id, reason, comment)
        VALUES (${user.id}, ${input.targetType}, ${targetId}, ${input.reason}, ${input.comment})
        ON CONFLICT (author_id, target_type, target_id) WHERE status = 'open' DO NOTHING
        RETURNING id`;
      if (!created) throw errors.conflict("already_reported", "Вы уже пожаловались — жалоба ждёт рассмотрения");

      if (input.targetType === "listing") {
        const [count] = await sql<{ count: number }[]>`
          SELECT count(DISTINCT author_id)::int AS count FROM reports
          WHERE target_type = 'listing' AND target_id = ${targetId} AND status = 'open' AND author_id IS NOT NULL`;
        if ((count?.count ?? 0) >= REPORTS_TO_HIDE) {
          const [hidden] = await sql<{ userId: string; title: string }[]>`
            UPDATE listings SET status = 'moderation', moderation_reason = 'Жалобы игроков', updated_at = now()
            WHERE id = ${targetId} AND status = 'active'
            RETURNING user_id, title`;
          if (hidden) {
            await notify(
              sql,
              hidden.userId,
              "listing_moderation",
              "Объявление на проверке",
              `На «${hidden.title}» пожаловались игроки. Модератор проверит его.`,
              "/my/listings",
            );
          }
        }
      }
      reply.code(201);
      return { id: created.id };
    },
  );
}
