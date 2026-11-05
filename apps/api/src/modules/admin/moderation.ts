import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  LISTING_TTL_DAYS,
  rejectListingSchema,
  resolveReportSchema,
  stopWordSchema,
  type FlaggedMessageDto,
  type ModerationListingDto,
  type ModerationSummaryDto,
  type AdminListingDto,
  type Paged,
  bulkListingsSchema,
  adminListingsQuery,
  type ModeratorConversationDto,
  type ReportDto,
  type StopWordDto,
} from "@twm/shared";
import type { AppContext } from "../../context.js";
import { writeAudit } from "../../lib/audit.js";
import { errors, parseBody } from "../../lib/errors.js";
import { mediaUrl } from "../../lib/media.js";
import { watchBack, watchClosed, watchPrice, watchSafely } from "../../lib/favorite-watch.js";
import { notify } from "../../lib/notify.js";
import { resetStopWordCache } from "../../lib/stop-words.js";
import { notifySavedSearchesLater } from "../saved-searches/routes.js";
import { requireStaff } from "../auth/guard.js";
import { MESSAGE_COLUMNS, toMessage, type MessageRow } from "../chat/service.js";

const uuidParam = z.object({ id: z.string().uuid() });
const snippet = (text: string, max = 200) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Модерация: объявления на проверке, жалобы, сообщения со стоп-словами,
 * сами стоп-слова. Каждое решение записывается в журнал действий.
 */
export async function adminModerationRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;
  const moderator = { preHandler: requireStaff(ctx, "moderator") };
  const admin = { preHandler: requireStaff(ctx, "admin") };

  const idOf = (request: FastifyRequest, what: string) => {
    const parsed = uuidParam.safeParse(request.params);
    if (!parsed.success) throw errors.notFound(`${what} не найдено`);
    return parsed.data.id;
  };

  app.get("/v1/admin/moderation/summary", moderator, async (): Promise<ModerationSummaryDto> => {
    const [row] = await sql<ModerationSummaryDto[]>`
      SELECT
        (SELECT count(*)::int FROM listings WHERE status = 'moderation') AS listings,
        (SELECT count(*)::int FROM reports WHERE status = 'open') AS reports,
        (SELECT count(*)::int FROM messages WHERE flagged AND hidden_at IS NULL) AS messages,
        (SELECT count(*)::int FROM nickname_verifications WHERE status = 'pending') AS verifications`;
    return row ?? { listings: 0, reports: 0, messages: 0, verifications: 0 };
  });

  // ── Объявления на проверке ────────────────────────────────────────────────

  app.get("/v1/admin/moderation/listings", moderator, async (): Promise<{ items: ModerationListingDto[] }> => {
    const rows = await sql<
      {
        id: string;
        title: string;
        description: string;
        price: string | null;
        operation: ModerationListingDto["operation"];
        sectionCode: ModerationListingDto["sectionCode"];
        serverNumber: number;
        serverName: string;
        serverColor: string;
        login: string;
        nickname: string;
        moderationReason: string | null;
        thumb: string | null;
        updatedAt: Date;
      }[]
    >`
      SELECT l.id, l.title, l.description, l.price, l.operation, s.code AS section_code,
             sv.number AS server_number, sv.name AS server_name, sv.color AS server_color,
             u.login, gp.nickname, l.moderation_reason, l.updated_at,
             (SELECT i.thumb_path FROM listing_images i WHERE i.listing_id = l.id
               ORDER BY i.is_main DESC, i.sort_order LIMIT 1) AS thumb
      FROM listings l
      JOIN listing_types t ON t.id = l.listing_type_id
      JOIN sections s ON s.id = t.section_id
      JOIN servers sv ON sv.id = l.server_id
      JOIN users u ON u.id = l.user_id
      JOIN game_profiles gp ON gp.id = l.game_profile_id
      WHERE l.status = 'moderation'
      ORDER BY l.updated_at
      LIMIT 200`;
    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        price: r.price === null ? null : Number(r.price),
        operation: r.operation,
        sectionCode: r.sectionCode,
        server: { number: r.serverNumber, name: r.serverName, color: r.serverColor },
        author: { login: r.login, nickname: r.nickname },
        moderationReason: r.moderationReason,
        image: r.thumb ? { url: mediaUrl(r.thumb), kind: "image" as const } : null,
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  });

  /** Закрывает открытые жалобы на объект вместе с решением по нему. */
  const closeReports = async (request: FastifyRequest, type: string, id: string, status: "resolved" | "dismissed", resolution: string) => {
    await sql`
      UPDATE reports SET status = ${status}, resolved_by = ${request.auth!.user.id}, resolved_at = now(), resolution = ${resolution}
      WHERE target_type = ${type} AND target_id = ${id} AND status = 'open'`;
  };

  /** Одобрить объявление на проверке. false — его уже нет в очереди. */
  const approveListing = async (request: FastifyRequest, id: string): Promise<boolean> => {
    const [row] = await sql<{ userId: string; title: string }[]>`
      UPDATE listings SET status = 'active', moderation_reason = NULL, rejection_reason = NULL,
        published_at = COALESCE(published_at, now()),
        expires_at = GREATEST(COALESCE(expires_at, now()), now() + make_interval(days => ${LISTING_TTL_DAYS}::int)),
        updated_at = now()
      WHERE id = ${id} AND status = 'moderation'
      RETURNING user_id, title`;
    if (!row) return false;
    await closeReports(request, "listing", id, "dismissed", "Объявление проверено и одобрено");
    await writeAudit(ctx, request, "listing.approved", { type: "listing", id });
    await notify(sql, row.userId, "listing_approved", "Объявление опубликовано", `«${row.title}» прошло проверку.`, `/listing/${id}`);
    notifySavedSearchesLater(ctx, id, request.log);
    await watchSafely(
      watchBack(sql, id).then(() => watchPrice(sql, id)),
      request.log,
    );
    return true;
  };

  /** Отклонить объявление (на проверке или опубликованное, например по жалобе). */
  const rejectListing = async (request: FastifyRequest, id: string, reason: string): Promise<boolean> => {
    const [row] = await sql<{ userId: string; title: string }[]>`
      UPDATE listings SET status = 'rejected', rejection_reason = ${reason}, moderation_reason = NULL, updated_at = now()
      WHERE id = ${id} AND status IN ('moderation', 'active')
      RETURNING user_id, title`;
    if (!row) return false;
    await closeReports(request, "listing", id, "resolved", `Объявление отклонено: ${reason}`);
    await writeAudit(ctx, request, "listing.rejected", { type: "listing", id }, { reason });
    await notify(sql, row.userId, "listing_rejected", "Объявление отклонено", `«${row.title}»: ${reason}`, "/my/listings");
    await watchSafely(watchClosed(sql, [id], "removed"), request.log);
    return true;
  };

  app.post("/v1/admin/moderation/listings/:id/approve", moderator, async (request) => {
    const id = idOf(request, "Объявление");
    if (!(await approveListing(request, id))) throw errors.notFound("Объявление не найдено или уже проверено");
    return { ok: true };
  });

  app.post("/v1/admin/moderation/listings/:id/reject", moderator, async (request) => {
    const id = idOf(request, "Объявление");
    const { reason } = parseBody(rejectListingSchema, request.body);
    if (!(await rejectListing(request, id, reason))) throw errors.notFound("Объявление не найдено");
    return { ok: true };
  });

  // ── Все объявления: поиск и массовые действия ─────────────────────────────

  app.get("/v1/admin/listings", moderator, async (request): Promise<Paged<AdminListingDto>> => {
    const q = adminListingsQuery.parse(request.query);
    const pageSize = 50;
    const conditions = [sql`true`];
    if (q.status) conditions.push(sql`l.status = ${q.status}`);
    if (q.server) conditions.push(sql`sv.number = ${q.server}::smallint`);
    if (q.login) conditions.push(sql`lower(u.login) = lower(${q.login})`);
    if (q.reported) conditions.push(sql`EXISTS (SELECT 1 FROM reports r WHERE r.target_type = 'listing' AND r.target_id = l.id::text AND r.status = 'open')`);
    if (q.q) {
      const like = `%${q.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(sql`(
        l.id::text = ${q.q} OR lower(l.title) LIKE ${like} OR lower(l.description) LIKE ${like}
        OR lower(gp.nickname) LIKE ${like} OR lower(u.login) LIKE ${like}
      )`);
    }
    const where = () => conditions.reduce((acc, c, i) => (i === 0 ? sql`WHERE ${c}` : sql`${acc} AND ${c}`), sql``);
    const from = () => sql`
      FROM listings l
      JOIN users u ON u.id = l.user_id
      JOIN game_profiles gp ON gp.id = l.game_profile_id
      JOIN servers sv ON sv.id = l.server_id
      JOIN listing_types t ON t.id = l.listing_type_id
      JOIN sections s ON s.id = t.section_id`;
    const [count] = await sql<{ total: number }[]>`SELECT count(*)::int AS total ${from()} ${where()}`;
    const rows = await sql<
      {
        id: string;
        title: string;
        price: string | null;
        operation: AdminListingDto["operation"];
        status: AdminListingDto["status"];
        sectionCode: AdminListingDto["sectionCode"];
        login: string;
        userStatus: "active" | "blocked";
        nickname: string;
        serverNumber: number;
        serverName: string;
        serverColor: string;
        createdAt: Date;
        publishedAt: Date | null;
        views: number;
        openReports: number;
        rejectionReason: string | null;
        moderationReason: string | null;
      }[]
    >`
      SELECT l.id, l.title, l.price, l.operation, l.status, s.code AS section_code,
        u.login, u.status AS user_status, gp.nickname,
        sv.number AS server_number, sv.name AS server_name, sv.color AS server_color,
        l.created_at, l.published_at, l.views, l.rejection_reason, l.moderation_reason,
        (SELECT count(*)::int FROM reports r WHERE r.target_type = 'listing' AND r.target_id = l.id::text AND r.status = 'open') AS open_reports
      ${from()} ${where()}
      ORDER BY l.updated_at DESC
      LIMIT ${pageSize}::int OFFSET ${(q.page - 1) * pageSize}::int`;
    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        price: r.price === null ? null : Number(r.price),
        operation: r.operation,
        status: r.status,
        sectionCode: r.sectionCode,
        author: { login: r.login, nickname: r.nickname, blocked: r.userStatus === "blocked" },
        server: { number: r.serverNumber, name: r.serverName, color: r.serverColor },
        createdAt: r.createdAt.toISOString(),
        publishedAt: r.publishedAt?.toISOString() ?? null,
        views: r.views,
        openReports: r.openReports,
        reason: r.rejectionReason ?? r.moderationReason,
      })),
      total: count?.total ?? 0,
      page: q.page,
      pageSize,
    };
  });

  app.post("/v1/admin/listings/bulk", moderator, async (request): Promise<{ done: number; skipped: number }> => {
    const input = parseBody(bulkListingsSchema, request.body);
    let done = 0;
    for (const id of input.ids) {
      const ok = input.action === "approve" ? await approveListing(request, id) : await rejectListing(request, id, input.reason ?? "");
      if (ok) done += 1;
    }
    return { done, skipped: input.ids.length - done };
  });

  // ── Жалобы ────────────────────────────────────────────────────────────────

  app.get("/v1/admin/reports", moderator, async (request): Promise<{ items: ReportDto[] }> => {
    const { status } = z.object({ status: z.enum(["open", "resolved", "dismissed"]).default("open") }).parse(request.query);
    const rows = await sql<
      {
        id: string;
        authorLogin: string | null;
        targetType: ReportDto["targetType"];
        targetId: string;
        reason: ReportDto["reason"];
        comment: string;
        status: ReportDto["status"];
        createdAt: Date;
        resolverLogin: string | null;
        resolvedAt: Date | null;
        resolution: string | null;
        listingId: string | null;
        listingTitle: string | null;
        listingText: string | null;
        conversationId: string | null;
        messageText: string | null;
        messageListingTitle: string | null;
        reviewText: string | null;
        reviewTargetLogin: string | null;
        userLogin: string | null;
        openCount: number;
      }[]
    >`
      SELECT r.id, a.login AS author_login, r.target_type, r.target_id, r.reason, r.comment, r.status,
             r.created_at, rv.login AS resolver_login, r.resolved_at, r.resolution,
             l.id AS listing_id, l.title AS listing_title, l.description AS listing_text,
             m.conversation_id, m.body AS message_text, ml.title AS message_listing_title,
             rw.comment AS review_text, rwt.login AS review_target_login,
             tu.login AS user_login,
             (SELECT count(*)::int FROM reports o
               WHERE o.target_type = r.target_type AND o.target_id = r.target_id AND o.status = 'open') AS open_count
      FROM reports r
      LEFT JOIN users a ON a.id = r.author_id
      LEFT JOIN users rv ON rv.id = r.resolved_by
      LEFT JOIN listings l ON r.target_type = 'listing' AND l.id::text = r.target_id
      LEFT JOIN messages m ON r.target_type = 'message' AND m.id::text = r.target_id
      LEFT JOIN conversations mc ON mc.id = m.conversation_id
      LEFT JOIN listings ml ON ml.id = mc.listing_id
      LEFT JOIN reviews rw ON r.target_type = 'review' AND rw.id::text = r.target_id
      LEFT JOIN users rwt ON rwt.id = rw.target_id
      LEFT JOIN users tu ON r.target_type = 'user' AND tu.id::text = r.target_id
      WHERE r.status = ${status}
      ORDER BY ${status === "open" ? sql`r.created_at` : sql`r.resolved_at DESC`}
      LIMIT 200`;
    return {
      items: rows.map((r) => {
        let target: ReportDto["target"];
        switch (r.targetType) {
          case "listing":
            target = { title: r.listingTitle ?? "Объявление удалено", text: snippet(r.listingText ?? ""), listingId: r.listingId, conversationId: null, userLogin: null };
            break;
          case "message":
            target = {
              title: `Сообщение по «${r.messageListingTitle ?? "—"}»`,
              text: snippet(r.messageText ?? ""),
              listingId: null,
              conversationId: r.conversationId,
              userLogin: null,
            };
            break;
          case "review":
            target = { title: `Отзыв о ${r.reviewTargetLogin ?? "—"}`, text: snippet(r.reviewText ?? ""), listingId: null, conversationId: null, userLogin: r.reviewTargetLogin };
            break;
          default:
            target = { title: `Игрок ${r.userLogin ?? "—"}`, text: "", listingId: null, conversationId: null, userLogin: r.userLogin };
        }
        return {
          id: r.id,
          author: r.authorLogin ? { login: r.authorLogin } : null,
          targetType: r.targetType,
          targetId: r.targetId,
          reason: r.reason,
          comment: r.comment,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          resolvedBy: r.resolverLogin ? { login: r.resolverLogin } : null,
          resolvedAt: r.resolvedAt?.toISOString() ?? null,
          resolution: r.resolution,
          target,
          openCount: r.openCount,
        };
      }),
    };
  });

  app.post("/v1/admin/reports/:id/resolve", moderator, async (request) => {
    const id = idOf(request, "Жалоба");
    const input = parseBody(resolveReportSchema, request.body);
    const [row] = await sql<{ authorId: string | null; targetType: string; targetId: string }[]>`
      UPDATE reports SET status = ${input.status}, resolved_by = ${request.auth!.user.id}, resolved_at = now(),
        resolution = ${input.resolution || null}
      WHERE id = ${id} AND status = 'open'
      RETURNING author_id, target_type, target_id`;
    if (!row) throw errors.notFound("Жалоба не найдена или уже рассмотрена");
    await writeAudit(ctx, request, `report.${input.status}`, { type: "report", id }, {
      target: `${row.targetType}:${row.targetId}`,
      resolution: input.resolution,
    });
    if (row.authorId) {
      await notify(
        sql,
        row.authorId,
        "report_resolved",
        "Жалоба рассмотрена",
        input.status === "resolved" ? "Модератор принял меры. Спасибо!" : "Модератор не нашёл нарушения.",
      );
    }
    return { ok: true };
  });

  // ── Сообщения со стоп-словами и переписка ─────────────────────────────────

  app.get("/v1/admin/messages/flagged", moderator, async (): Promise<{ items: FlaggedMessageDto[] }> => {
    const rows = await sql<
      { id: string; conversationId: string; body: string; flagReason: string | null; senderLogin: string | null; listingTitle: string; createdAt: Date }[]
    >`
      SELECT m.id, m.conversation_id, m.body, m.flag_reason, u.login AS sender_login, l.title AS listing_title, m.created_at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN listings l ON l.id = c.listing_id
      LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.flagged AND m.hidden_at IS NULL
      ORDER BY m.created_at
      LIMIT 200`;
    return {
      items: rows.map((r) => ({
        id: r.id,
        conversationId: r.conversationId,
        body: r.body,
        flagReason: r.flagReason,
        sender: r.senderLogin ? { login: r.senderLogin } : null,
        listingTitle: r.listingTitle,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  app.post("/v1/admin/messages/:id/hide", moderator, async (request) => {
    const id = idOf(request, "Сообщение");
    const [row] = await sql<{ id: string }[]>`
      UPDATE messages SET hidden_at = now(), hidden_by = ${request.auth!.user.id}, flagged = false
      WHERE id = ${id} AND hidden_at IS NULL RETURNING id`;
    if (!row) throw errors.notFound("Сообщение не найдено");
    await closeReports(request, "message", id, "resolved", "Сообщение скрыто");
    await writeAudit(ctx, request, "message.hidden", { type: "message", id });
    return { ok: true };
  });

  // Ложное срабатывание стоп-слова: снять отметку.
  app.post("/v1/admin/messages/:id/clear", moderator, async (request) => {
    const id = idOf(request, "Сообщение");
    const [row] = await sql<{ id: string }[]>`UPDATE messages SET flagged = false WHERE id = ${id} AND flagged RETURNING id`;
    if (!row) throw errors.notFound("Сообщение не найдено");
    await writeAudit(ctx, request, "message.cleared", { type: "message", id });
    return { ok: true };
  });

  // Чтение чужой переписки — только по жалобе или стоп-слову, и всегда с записью в журнал.
  app.get("/v1/admin/conversations/:id", moderator, async (request): Promise<ModeratorConversationDto> => {
    const id = idOf(request, "Переписка");
    const [conv] = await sql<{ listingId: string; listingTitle: string; buyerLogin: string; sellerLogin: string; buyerId: string }[]>`
      SELECT c.listing_id, l.title AS listing_title, b.login AS buyer_login, s.login AS seller_login, c.buyer_id
      FROM conversations c JOIN listings l ON l.id = c.listing_id
      JOIN users b ON b.id = c.buyer_id JOIN users s ON s.id = c.seller_id
      WHERE c.id = ${id}`;
    if (!conv) throw errors.notFound("Переписка не найдена");
    const rows = await sql<(MessageRow & { senderLogin: string | null })[]>`
      SELECT ${sql.unsafe(MESSAGE_COLUMNS.split(", ").map((c) => `m.${c}`).join(", "))}, u.login AS sender_login
      FROM messages m LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ${id}
      ORDER BY m.created_at
      LIMIT 500`;
    await writeAudit(ctx, request, "conversation.viewed", { type: "conversation", id });
    return {
      id,
      listing: { id: conv.listingId, title: conv.listingTitle },
      buyer: { login: conv.buyerLogin },
      seller: { login: conv.sellerLogin },
      messages: rows.map((m) => ({
        // Модератор видит и скрытые сообщения; «моё» — сообщения покупателя.
        ...toMessage({ ...m, hiddenAt: null }, conv.buyerId),
        hidden: m.hiddenAt !== null,
        senderLogin: m.senderLogin,
        flagged: m.flagged,
      })),
    };
  });

  app.post("/v1/admin/reviews/:id/hide", moderator, async (request) => {
    const id = idOf(request, "Отзыв");
    const [row] = await sql<{ id: string }[]>`
      UPDATE reviews SET hidden_at = now() WHERE id = ${id} AND hidden_at IS NULL RETURNING id`;
    if (!row) throw errors.notFound("Отзыв не найден");
    await closeReports(request, "review", id, "resolved", "Отзыв скрыт");
    await writeAudit(ctx, request, "review.hidden", { type: "review", id });
    return { ok: true };
  });

  // ── Стоп-слова ────────────────────────────────────────────────────────────

  interface StopWordRow {
    id: number;
    phrase: string;
    isRegex: boolean;
    note: string | null;
    createdAt: Date;
  }
  const toStopWord = (r: StopWordRow): StopWordDto => ({ ...r, createdAt: r.createdAt.toISOString() });

  app.get("/v1/admin/stop-words", moderator, async (): Promise<{ items: StopWordDto[] }> => {
    const rows = await sql<StopWordRow[]>`SELECT id, phrase, is_regex, note, created_at FROM stop_words ORDER BY phrase`;
    return { items: rows.map(toStopWord) };
  });

  app.post("/v1/admin/stop-words", admin, async (request, reply): Promise<StopWordDto> => {
    const input = parseBody(stopWordSchema, request.body);
    const [row] = await sql<StopWordRow[]>`
      INSERT INTO stop_words (phrase, is_regex, note, created_by)
      VALUES (${input.phrase}, ${input.isRegex}, ${input.note}, ${request.auth!.user.id})
      ON CONFLICT DO NOTHING
      RETURNING id, phrase, is_regex, note, created_at`;
    if (!row) throw errors.conflict("duplicate", "Такое стоп-слово уже есть", { phrase: "Уже в списке" });
    resetStopWordCache();
    await writeAudit(ctx, request, "stop_word.created", { type: "stop_word", id: row.id }, { phrase: input.phrase });
    reply.code(201);
    return toStopWord(row);
  });

  app.delete("/v1/admin/stop-words/:id", admin, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const [row] = await sql<{ phrase: string }[]>`DELETE FROM stop_words WHERE id = ${id} RETURNING phrase`;
    if (!row) throw errors.notFound("Стоп-слово не найдено");
    resetStopWordCache();
    await writeAudit(ctx, request, "stop_word.deleted", { type: "stop_word", id }, { phrase: row.phrase });
    return reply.code(204).send();
  });
}
