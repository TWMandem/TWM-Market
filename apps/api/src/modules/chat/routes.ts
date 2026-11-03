import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CHAT_TEMPLATE_LIMIT,
  chatTemplatesSchema,
  messageSchema,
  reviewSchema,
  type BlockedUserDto,
  type ConversationDto,
  type MessageDto,
  type MessagesPageDto,
  type NotificationDto,
  type PublicUserDto,
  type ReviewDto,
  type UpdatesDto,
} from "@twm/shared";
import type { AppContext } from "../../context.js";
import { AppError, errors, parseBody } from "../../lib/errors.js";
import { saveChatImage } from "../../lib/media.js";
import { notify } from "../../lib/notify.js";
import { stopWordReason } from "../../lib/stop-words.js";
import { visibleLastSeen } from "../../lib/activity.js";
import { authOf, optionalAuth, requireAuth } from "../auth/guard.js";
import {
  MESSAGE_COLUMNS,
  blockedBetween,
  chatBlocked,
  conversationSelect,
  participantConversation,
  reviewSelect,
  toConversations,
  toMessage,
  toReview,
  type ConversationRow,
  type MessageRow,
} from "./service.js";

const idParam = z.object({ id: z.string().uuid() });
const PAGE = 50;

/** Короткий текст сообщения для уведомления. */
const snippet = (text: string) => (text.length > 120 ? `${text.slice(0, 117)}…` : text);

/**
 * Переписка покупателя и продавца по объявлению, сделка с подтверждением
 * обеих сторон, отзывы и уведомления.
 */
export async function chatRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;
  const auth = requireAuth(ctx);
  const maybeAuth = optionalAuth(ctx);

  const conversationOf = async (request: FastifyRequest) => {
    const { user } = authOf(request);
    const params = idParam.safeParse(request.params);
    if (!params.success) throw errors.notFound("Переписка не найдена");
    const row = await participantConversation(sql, params.data.id, user.id);
    return { user, row, other: row.buyerId === user.id ? row.sellerId : row.buyerId };
  };

  const one = async (row: ConversationRow, viewerId: string): Promise<ConversationDto> => {
    const fresh = await participantConversation(sql, row.id, viewerId);
    return (await toConversations(sql, [fresh], viewerId))[0]!;
  };

  const markRead = async (row: ConversationRow, viewerId: string) => {
    if (row.buyerId === viewerId) await sql`UPDATE conversations SET buyer_last_read_at = now() WHERE id = ${row.id}`;
    else await sql`UPDATE conversations SET seller_last_read_at = now() WHERE id = ${row.id}`;
  };

  /** Новое сообщение: время последнего сообщения, прочитано отправителем. */
  const touch = async (row: ConversationRow, senderId: string | null) => {
    await sql`
      UPDATE conversations SET
        last_message_at = now(),
        buyer_last_read_at = CASE WHEN ${senderId}::uuid = buyer_id THEN now() ELSE buyer_last_read_at END,
        seller_last_read_at = CASE WHEN ${senderId}::uuid = seller_id THEN now() ELSE seller_last_read_at END
      WHERE id = ${row.id}`;
  };

  const systemMessage = async (row: ConversationRow, kind: "deal_proposed" | "deal_confirmed" | "deal_cancelled", body: string) => {
    await sql`INSERT INTO messages (conversation_id, sender_id, kind, body) VALUES (${row.id}, NULL, ${kind}, ${body})`;
    await touch(row, null);
  };

  // ── Начать переписку по объявлению ────────────────────────────────────────

  app.post(
    "/v1/listings/:id/conversations",
    { preHandler: auth, config: { rateLimit: { max: 30, timeWindow: "1 hour" } } },
    async (request): Promise<ConversationDto> => {
      const { user } = authOf(request);
      const params = idParam.safeParse(request.params);
      if (!params.success) throw errors.notFound("Объявление не найдено");
      if (!user.emailVerifiedAt) {
        throw new AppError(403, "email_not_verified", "Подтвердите email, чтобы писать продавцам");
      }
      const [listing] = await sql<{ id: string; userId: string; status: string; expiresAt: Date | null }[]>`
        SELECT id, user_id, status, expires_at FROM listings WHERE id = ${params.data.id}`;
      if (!listing) throw errors.notFound("Объявление не найдено");
      if (listing.userId === user.id) throw errors.conflict("own_listing", "Это ваше объявление");
      if (await blockedBetween(sql, user.id, listing.userId)) throw chatBlocked();

      const [existing] = await sql<{ id: string }[]>`
        SELECT id FROM conversations WHERE listing_id = ${listing.id} AND buyer_id = ${user.id}`;
      if (existing) return one({ id: existing.id } as ConversationRow, user.id);

      const [owner] = await sql<{ status: string }[]>`SELECT status FROM users WHERE id = ${listing.userId}`;
      const active =
        listing.status === "active" && listing.expiresAt !== null && listing.expiresAt.getTime() > Date.now() && owner?.status === "active";
      if (!active) throw errors.conflict("listing_inactive", "Объявление снято с публикации — написать по нему нельзя");

      const [created] = await sql<{ id: string }[]>`
        INSERT INTO conversations (listing_id, buyer_id, seller_id)
        VALUES (${listing.id}, ${user.id}, ${listing.userId})
        ON CONFLICT (listing_id, buyer_id) DO UPDATE SET listing_id = EXCLUDED.listing_id
        RETURNING id`;
      return one({ id: created!.id } as ConversationRow, user.id);
    },
  );

  // ── Список переписок и одна переписка ─────────────────────────────────────

  app.get("/v1/me/conversations", { preHandler: auth }, async (request): Promise<{ items: ConversationDto[] }> => {
    const { user } = authOf(request);
    // Продавец видит переписку, только когда покупатель что-то написал.
    const rows = await sql<ConversationRow[]>`
      ${conversationSelect(sql, user.id)}
      WHERE c.buyer_id = ${user.id}
         OR (c.seller_id = ${user.id} AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id))
      ORDER BY c.last_message_at DESC
      LIMIT 200`;
    return { items: await toConversations(sql, rows, user.id) };
  });

  app.get("/v1/conversations/:id", { preHandler: auth }, async (request): Promise<ConversationDto> => {
    const { user, row } = await conversationOf(request);
    return (await toConversations(sql, [row], user.id))[0]!;
  });

  app.get("/v1/conversations/:id/messages", { preHandler: auth }, async (request): Promise<MessagesPageDto> => {
    const { user, row } = await conversationOf(request);
    const { before, after } = z
      .object({ before: z.string().datetime().optional(), after: z.string().datetime().optional() })
      .parse(request.query);
    const rows = await sql<MessageRow[]>`
      SELECT ${sql.unsafe(MESSAGE_COLUMNS)} FROM messages
      WHERE conversation_id = ${row.id}
        ${before ? sql`AND created_at < ${before}::timestamptz` : sql``}
        ${after ? sql`AND created_at > ${after}::timestamptz` : sql``}
      ORDER BY created_at DESC
      LIMIT ${PAGE + 1}::int`;
    const hasMore = rows.length > PAGE;
    // Открыть переписку — значит прочитать её.
    await markRead(row, user.id);
    return { items: rows.slice(0, PAGE).reverse().map((m) => toMessage(m, user.id)), hasMore };
  });

  app.post("/v1/conversations/:id/read", { preHandler: auth }, async (request, reply) => {
    const { user, row } = await conversationOf(request);
    await markRead(row, user.id);
    return reply.code(204).send();
  });

  // ── Сообщения ─────────────────────────────────────────────────────────────

  const afterMessage = async (row: ConversationRow, senderId: string, other: string, preview: string) => {
    await touch(row, senderId);
    await notify(sql, other, "message", `Новое сообщение: ${row.listingTitle}`, preview, `/chats/${row.id}`);
  };

  app.post(
    "/v1/conversations/:id/messages",
    { preHandler: auth, config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    async (request, reply): Promise<MessageDto> => {
      const { user, row, other } = await conversationOf(request);
      if (row.blocked) throw chatBlocked();
      const { body } = parseBody(messageSchema, request.body);
      // Стоп-слово не мешает доставке, но сообщение увидит модератор.
      const flag = await stopWordReason(sql, body);
      const [message] = await sql<MessageRow[]>`
        INSERT INTO messages (conversation_id, sender_id, kind, body, flagged, flag_reason)
        VALUES (${row.id}, ${user.id}, 'text', ${body}, ${flag !== null}, ${flag})
        RETURNING ${sql.unsafe(MESSAGE_COLUMNS)}`;
      await afterMessage(row, user.id, other, snippet(body));
      reply.code(201);
      return toMessage(message!, user.id);
    },
  );

  app.post(
    "/v1/conversations/:id/images",
    { preHandler: auth, config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } },
    async (request, reply): Promise<MessageDto> => {
      const { user, row, other } = await conversationOf(request);
      if (row.blocked) throw chatBlocked();
      const file = await request.file();
      if (!file) throw errors.validation({ file: "Прикрепите изображение" });
      const saved = await saveChatImage(ctx.uploadDir, row.id, await file.toBuffer());
      const [message] = await sql<MessageRow[]>`
        INSERT INTO messages (conversation_id, sender_id, kind, image_path, image_width, image_height)
        VALUES (${row.id}, ${user.id}, 'image', ${saved.path}, ${saved.width}::int, ${saved.height}::int)
        RETURNING ${sql.unsafe(MESSAGE_COLUMNS)}`;
      await afterMessage(row, user.id, other, "Скриншот");
      reply.code(201);
      return toMessage(message!, user.id);
    },
  );

  // ── Сделка ────────────────────────────────────────────────────────────────
  // Одна сторона отмечает «Сделка состоялась», другая подтверждает.
  // Площадка не участвует в сделке: это только отметка для отзывов.

  app.post("/v1/conversations/:id/deal", { preHandler: auth }, async (request): Promise<ConversationDto> => {
    const { user, row, other } = await conversationOf(request);
    if (row.dealStatus === "proposed") throw errors.conflict("deal_pending", "Сделка уже ждёт подтверждения");
    if (row.dealStatus === "confirmed") throw errors.conflict("deal_confirmed", "Сделка уже подтверждена");
    const [messages] = await sql<{ count: number }[]>`
      SELECT count(DISTINCT sender_id)::int AS count FROM messages WHERE conversation_id = ${row.id} AND sender_id IS NOT NULL`;
    if ((messages?.count ?? 0) < 2) {
      throw errors.conflict("deal_too_early", "Отметить сделку можно, когда в переписке написали обе стороны");
    }
    await sql`
      INSERT INTO deals (conversation_id, listing_id, buyer_id, seller_id, proposed_by)
      VALUES (${row.id}, ${row.listingId}, ${row.buyerId}, ${row.sellerId}, ${user.id})
      ON CONFLICT (conversation_id) DO UPDATE SET
        status = 'proposed', proposed_by = EXCLUDED.proposed_by, proposed_at = now(), confirmed_at = NULL`;
    await systemMessage(row, "deal_proposed", `${user.login} отметил(а), что сделка состоялась. Вторая сторона должна подтвердить.`);
    await notify(sql, other, "deal_proposed", "Подтвердите сделку", `${user.login} отметил(а) сделку по «${row.listingTitle}»`, `/chats/${row.id}`);
    return one(row, user.id);
  });

  app.post("/v1/conversations/:id/deal/confirm", { preHandler: auth }, async (request): Promise<ConversationDto> => {
    const { user, row, other } = await conversationOf(request);
    if (row.dealStatus !== "proposed") throw errors.conflict("no_deal", "Нет сделки, ожидающей подтверждения");
    if (row.dealProposedBy === user.id) throw errors.conflict("own_proposal", "Сделку должна подтвердить другая сторона");
    await sql`UPDATE deals SET status = 'confirmed', confirmed_at = now() WHERE conversation_id = ${row.id}`;
    await systemMessage(row, "deal_confirmed", "Сделка подтверждена обеими сторонами. Теперь можно оставить отзыв.");
    await notify(sql, other, "deal_confirmed", "Сделка подтверждена", `Оставьте отзыв о сделке по «${row.listingTitle}»`, `/chats/${row.id}`);
    return one(row, user.id);
  });

  app.post("/v1/conversations/:id/deal/cancel", { preHandler: auth }, async (request): Promise<ConversationDto> => {
    const { user, row, other } = await conversationOf(request);
    if (row.dealStatus !== "proposed") throw errors.conflict("no_deal", "Отменить можно только неподтверждённую сделку");
    await sql`UPDATE deals SET status = 'cancelled' WHERE conversation_id = ${row.id}`;
    const declined = row.dealProposedBy !== user.id;
    await systemMessage(row, "deal_cancelled", declined ? `${user.login} не подтвердил(а) сделку.` : `${user.login} отменил(а) отметку о сделке.`);
    await notify(sql, other, "deal_cancelled", "Отметка о сделке снята", `По «${row.listingTitle}»`, `/chats/${row.id}`);
    return one(row, user.id);
  });

  app.post(
    "/v1/conversations/:id/review",
    { preHandler: auth, config: { rateLimit: { max: 20, timeWindow: "1 hour" } } },
    async (request, reply): Promise<ConversationDto> => {
      const { user, row, other } = await conversationOf(request);
      if (row.dealStatus !== "confirmed" || !row.dealId) {
        throw errors.conflict("no_confirmed_deal", "Отзыв можно оставить только после подтверждённой сделки");
      }
      const input = parseBody(reviewSchema, request.body);
      const [created] = await sql<{ id: string }[]>`
        INSERT INTO reviews (deal_id, author_id, target_id, positive, comment)
        VALUES (${row.dealId}, ${user.id}, ${other}, ${input.positive}, ${input.comment})
        ON CONFLICT (deal_id, author_id) DO NOTHING
        RETURNING id`;
      if (!created) throw errors.conflict("already_reviewed", "Вы уже оставили отзыв об этой сделке");
      await notify(
        sql,
        other,
        "review",
        input.positive ? "Положительный отзыв" : "Отрицательный отзыв",
        `${user.login}: ${snippet(input.comment || row.listingTitle)}`,
        `/user/${encodeURIComponent(user.login)}`,
      );
      reply.code(201);
      return one(row, user.id);
    },
  );

  // ── Профиль игрока: отзывы ────────────────────────────────────────────────

  app.get("/v1/users/:login", { preHandler: maybeAuth }, async (request): Promise<PublicUserDto> => {
    const { login } = z.object({ login: z.string().min(1).max(40) }).parse(request.params);
    const [user] = await sql<{ id: string; login: string; createdAt: Date; status: string; lastSeenAt: Date | null; showOnline: boolean }[]>`
      SELECT id, login, created_at, status, last_seen_at, show_online FROM users WHERE lower(login) = lower(${login})`;
    if (!user) throw errors.notFound("Игрок не найден");
    const [stats] = await sql<{ positive: number; negative: number; deals: number; activeListings: number }[]>`
      SELECT
        (SELECT count(*)::int FROM reviews WHERE target_id = ${user.id} AND positive AND hidden_at IS NULL) AS positive,
        (SELECT count(*)::int FROM reviews WHERE target_id = ${user.id} AND NOT positive AND hidden_at IS NULL) AS negative,
        (SELECT count(*)::int FROM deals WHERE (buyer_id = ${user.id} OR seller_id = ${user.id}) AND status = 'confirmed') AS deals,
        (SELECT count(*)::int FROM listings WHERE user_id = ${user.id} AND status = 'active' AND expires_at > now()) AS active_listings`;
    const recent = await sql<Parameters<typeof toReview>[0][]>`
      ${reviewSelect(sql)} WHERE r.target_id = ${user.id} AND r.hidden_at IS NULL
      ORDER BY r.created_at DESC LIMIT 30`;
    const viewer = request.auth?.user ?? null;
    const [blocked] = viewer
      ? await sql`SELECT 1 FROM user_blocks WHERE user_id = ${viewer.id} AND blocked_id = ${user.id}`
      : [];
    return {
      login: user.login,
      memberSince: user.createdAt.toISOString(),
      lastSeenAt: user.status === "blocked" ? null : visibleLastSeen(user),
      blockedByMe: Boolean(blocked),
      reviews: { positive: stats?.positive ?? 0, negative: stats?.negative ?? 0 },
      deals: stats?.deals ?? 0,
      activeListings: user.status === "blocked" ? 0 : stats?.activeListings ?? 0,
      recentReviews: recent.map(toReview),
    };
  });

  // ── Уведомления ───────────────────────────────────────────────────────────

  interface NotificationRow {
    id: string;
    kind: NotificationDto["kind"];
    title: string;
    body: string;
    link: string | null;
    createdAt: Date;
    readAt: Date | null;
  }
  const toNotification = (n: NotificationRow): NotificationDto => ({
    id: Number(n.id),
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link,
    createdAt: n.createdAt.toISOString(),
    read: n.readAt !== null,
  });

  // Приложение опрашивает раз в несколько секунд: счётчики и новые уведомления.
  app.get("/v1/me/updates", { preHandler: auth }, async (request): Promise<UpdatesDto> => {
    const { user } = authOf(request);
    const { after } = z.object({ after: z.coerce.number().int().min(0).optional() }).parse(request.query);
    const [counts] = await sql<{ unreadMessages: number; unreadNotifications: number; cursor: string | null }[]>`
      SELECT
        (SELECT count(*)::int FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE (c.buyer_id = ${user.id} OR c.seller_id = ${user.id})
            AND m.sender_id IS DISTINCT FROM ${user.id}
            AND m.created_at > CASE WHEN c.buyer_id = ${user.id} THEN c.buyer_last_read_at ELSE c.seller_last_read_at END
        ) AS unread_messages,
        (SELECT count(*)::int FROM notifications WHERE user_id = ${user.id} AND read_at IS NULL) AS unread_notifications,
        (SELECT max(id) FROM notifications WHERE user_id = ${user.id}) AS cursor`;
    const cursor = Number(counts?.cursor ?? 0);
    // Первый опрос только запоминает курсор: старые уведомления не всплывают заново.
    const fresh =
      after === undefined
        ? []
        : await sql<NotificationRow[]>`
            SELECT id, kind, title, body, link, created_at, read_at FROM notifications
            WHERE user_id = ${user.id} AND id > ${after}::bigint
            ORDER BY id LIMIT 20`;
    return {
      unreadMessages: counts?.unreadMessages ?? 0,
      unreadNotifications: counts?.unreadNotifications ?? 0,
      notifications: fresh.map(toNotification),
      cursor,
    };
  });

  app.get("/v1/me/notifications", { preHandler: auth }, async (request): Promise<{ items: NotificationDto[] }> => {
    const { user } = authOf(request);
    const rows = await sql<NotificationRow[]>`
      SELECT id, kind, title, body, link, created_at, read_at FROM notifications
      WHERE user_id = ${user.id} ORDER BY id DESC LIMIT 50`;
    return { items: rows.map(toNotification) };
  });

  app.post("/v1/me/notifications/read", { preHandler: auth }, async (request, reply) => {
    const { user } = authOf(request);
    const { ids } = z.object({ ids: z.array(z.number().int().positive()).max(200).optional() }).parse(request.body ?? {});
    if (ids && ids.length > 0) {
      await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${user.id} AND id = ANY(${ids}::bigint[]) AND read_at IS NULL`;
    } else {
      await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${user.id} AND read_at IS NULL`;
    }
    return reply.code(204).send();
  });

  // Отзывы о продавце для карточки объявления: короткая сводка.
  // ── Чёрный список ─────────────────────────────────────────────────────────
  // Заблокированный не может начать переписку и писать в уже начатую.
  // Отметить сделку и оставить отзыв по-прежнему можно.

  const targetOf = async (request: FastifyRequest) => {
    const { user } = authOf(request);
    const { login } = z.object({ login: z.string().min(1).max(40) }).parse(request.params);
    const [target] = await sql<{ id: string; login: string }[]>`SELECT id, login FROM users WHERE lower(login) = lower(${login})`;
    if (!target) throw errors.notFound("Игрок не найден");
    if (target.id === user.id) throw errors.conflict("self_block", "Нельзя заблокировать себя");
    return { user, target };
  };

  app.post("/v1/users/:login/block", { preHandler: auth }, async (request, reply) => {
    const { user, target } = await targetOf(request);
    const [count] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM user_blocks WHERE user_id = ${user.id}`;
    if ((count?.count ?? 0) >= 500) throw errors.conflict("too_many_blocks", "Чёрный список переполнен — уберите оттуда кого-нибудь");
    await sql`INSERT INTO user_blocks (user_id, blocked_id) VALUES (${user.id}, ${target.id}) ON CONFLICT DO NOTHING`;
    return reply.code(204).send();
  });

  app.delete("/v1/users/:login/block", { preHandler: auth }, async (request, reply) => {
    const { user, target } = await targetOf(request);
    await sql`DELETE FROM user_blocks WHERE user_id = ${user.id} AND blocked_id = ${target.id}`;
    return reply.code(204).send();
  });

  app.get("/v1/me/blocks", { preHandler: auth }, async (request): Promise<{ items: BlockedUserDto[] }> => {
    const { user } = authOf(request);
    const rows = await sql<{ login: string; createdAt: Date }[]>`
      SELECT u.login, b.created_at FROM user_blocks b JOIN users u ON u.id = b.blocked_id
      WHERE b.user_id = ${user.id} ORDER BY b.created_at DESC`;
    return { items: rows.map((r) => ({ login: r.login, createdAt: r.createdAt.toISOString() })) };
  });

  // ── Шаблоны ответов ───────────────────────────────────────────────────────

  app.get("/v1/me/chat-templates", { preHandler: auth }, async (request): Promise<{ items: string[] }> => {
    const { user } = authOf(request);
    const rows = await sql<{ body: string }[]>`
      SELECT body FROM chat_templates WHERE user_id = ${user.id} ORDER BY sort_order, id LIMIT ${CHAT_TEMPLATE_LIMIT}::int`;
    return { items: rows.map((r) => r.body) };
  });

  // Список сохраняется целиком: так проще менять порядок и удалять.
  app.put("/v1/me/chat-templates", { preHandler: auth }, async (request): Promise<{ items: string[] }> => {
    const { user } = authOf(request);
    const { items } = parseBody(chatTemplatesSchema, request.body);
    await sql.begin(async (tx) => {
      await tx`DELETE FROM chat_templates WHERE user_id = ${user.id}`;
      for (const [index, body] of items.entries()) {
        await tx`INSERT INTO chat_templates (user_id, body, sort_order) VALUES (${user.id}, ${body}, ${index}::int)`;
      }
    });
    return { items };
  });

  app.get("/v1/users/:login/reviews", async (request): Promise<{ items: ReviewDto[] }> => {
    const { login } = z.object({ login: z.string().min(1).max(40) }).parse(request.params);
    const rows = await sql<Parameters<typeof toReview>[0][]>`
      ${reviewSelect(sql)}
      JOIN users t ON t.id = r.target_id
      WHERE lower(t.login) = lower(${login}) AND r.hidden_at IS NULL
      ORDER BY r.created_at DESC LIMIT 100`;
    return { items: rows.map(toReview) };
  });
}
