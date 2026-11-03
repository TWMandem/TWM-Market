import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  LISTING_STATS_DAYS,
  LISTING_TTL_DAYS,
  MAX_ACTIVE_LISTINGS,
  imageOrderSchema,
  listingInputSchema,
  type ListingCardDto,
  type ListingSearchResultDto,
  type ListingStatsDto,
} from "@twm/shared";
import type { AppContext } from "../../context.js";
import type { Fragment } from "../../db/client.js";
import { AppError, errors, parseBody } from "../../lib/errors.js";
import { removeMedia, removeMediaDir, saveListingImage } from "../../lib/media.js";
import { dayMinus, dayRange, mskDay } from "../../lib/day.js";
import { stopWordReason } from "../../lib/stop-words.js";
import { authOf, hasRole, optionalAuth, requireAuth } from "../auth/guard.js";
import { notifySavedSearchesLater } from "../saved-searches/routes.js";
import { filterDefinitions, ownerActive, searchConditions, searchFrom, searchQuery, whereOf } from "./search.js";
import {
  listingSelect,
  loadImages,
  loadListingRow,
  notOwner,
  toCard,
  toDetail,
  bumpAvailableAt,
  toMyListing,
  validateListing,
  type ListingRow,
} from "./service.js";

const idParam = z.object({ id: z.string().uuid() });
const PAGE_SIZE = 24;

export async function listingRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;
  const auth = requireAuth(ctx);
  const maybeAuth = optionalAuth(ctx);

  const ownListing = async (request: FastifyRequest) => {
    const { user } = authOf(request);
    const params = idParam.safeParse(request.params);
    if (!params.success) throw notOwner();
    const row = await loadListingRow(sql, params.data.id, user.id);
    if (!row || row.userId !== user.id) throw notOwner();
    return { user, row };
  };

  const fresh = async (id: string, viewerId: string) => {
    const row = await loadListingRow(sql, id, viewerId);
    if (!row) throw notOwner();
    return toMyListing(ctx, row);
  };

  // ── Поиск и каталог ───────────────────────────────────────────────────────

  app.get("/v1/listings", { preHandler: maybeAuth }, async (request): Promise<ListingSearchResultDto> => {
    const q = searchQuery.parse(request.query);
    const raw = request.query as Record<string, string | undefined>;
    const viewerId = request.auth?.user.id ?? null;

    const definitions = await filterDefinitions(sql, q.type);
    const where = (): Fragment => whereOf(sql, searchConditions(sql, q, raw, definitions));

    const order = () => {
      switch (q.sort) {
        case "price_asc":
          return sql`ORDER BY l.price ASC NULLS LAST, l.published_at DESC`;
        case "price_desc":
          return sql`ORDER BY l.price DESC NULLS LAST, l.published_at DESC`;
        case "popular":
          return sql`ORDER BY l.views DESC, l.published_at DESC`;
        default:
          // Поднятые объявления — вместе со свежими.
          return sql`ORDER BY COALESCE(l.bumped_at, l.published_at) DESC`;
      }
    };

    const [count] = await sql<{ total: number }[]>`
      SELECT count(*)::int AS total
      ${searchFrom(sql)}
      ${where()}`;
    const rows = await sql<ListingRow[]>`
      ${listingSelect(sql, viewerId)}
      ${where()}
      ${order()}
      LIMIT ${PAGE_SIZE}::int OFFSET ${(q.page - 1) * PAGE_SIZE}::int`;

    return { items: rows.map(toCard), total: count?.total ?? 0, page: q.page, pageSize: PAGE_SIZE };
  });

  // ── Карточка объявления ───────────────────────────────────────────────────

  app.get("/v1/listings/:id", { preHandler: maybeAuth }, async (request) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) throw notOwner();
    const viewer = request.auth?.user ?? null;
    const row = await loadListingRow(sql, params.data.id, viewer?.id ?? null);
    if (!row) throw notOwner();

    const [owner] = await sql<{ status: string }[]>`SELECT status FROM users WHERE id = ${row.userId}`;
    const isPublic =
      row.status === "active" && row.expiresAt !== null && row.expiresAt.getTime() > Date.now() && owner?.status === "active";
    const canSeeHidden = viewer !== null && (viewer.id === row.userId || hasRole(viewer.role, "moderator"));
    if (!isPublic && !canSeeHidden) throw notOwner();

    // Просмотры владельца не считаются.
    if (isPublic && viewer?.id !== row.userId) {
      await sql`UPDATE listings SET views = views + 1 WHERE id = ${row.id}`;
      await sql`
        INSERT INTO listing_views_daily (listing_id, day, views) VALUES (${row.id}, ${mskDay()}::date, 1)
        ON CONFLICT (listing_id, day) DO UPDATE SET views = listing_views_daily.views + 1`;
      row.views += 1;
    }
    return toDetail(ctx, row, viewer?.id ?? null);
  });

  // Похожие предложения: тот же предмет или модель, затем та же категория.
  // Сначала свой сервер (или с переводом), затем ближе по цене.
  app.get("/v1/listings/:id/similar", { preHandler: maybeAuth }, async (request): Promise<{ items: ListingCardDto[] }> => {
    const params = idParam.safeParse(request.params);
    if (!params.success) throw notOwner();
    const viewerId = request.auth?.user.id ?? null;
    const [base] = await sql<
      { id: string; userId: string; listingTypeId: number; operation: string; catalogItemId: number | null; categoryId: number | null; serverId: number; price: string | null; title: string }[]
    >`
      SELECT id, user_id, listing_type_id, operation, catalog_item_id, category_id, server_id, price, title
      FROM listings WHERE id = ${params.data.id}`;
    if (!base) throw notOwner();

    const match =
      base.catalogItemId !== null
        ? base.categoryId !== null
          ? sql`(l.catalog_item_id = ${base.catalogItemId} OR l.category_id = ${base.categoryId})`
          : sql`l.catalog_item_id = ${base.catalogItemId}`
        : base.categoryId !== null
          ? sql`l.category_id = ${base.categoryId}`
          : sql`l.search_vector @@ plainto_tsquery('russian', ${base.title})`;
    const rows = await sql<ListingRow[]>`
      ${listingSelect(sql, viewerId)}
      WHERE l.status = 'active' AND l.expires_at > now() AND s.is_active AND t.is_active AND ${ownerActive(sql)}
        AND l.id <> ${base.id} AND l.user_id <> ${base.userId}
        AND l.listing_type_id = ${base.listingTypeId} AND l.operation = ${base.operation}
        AND ${match}
      ORDER BY
        ${base.catalogItemId !== null ? sql`(l.catalog_item_id = ${base.catalogItemId}) DESC,` : sql``}
        (l.server_id = ${base.serverId} OR l.transfer_mode <> 'none') DESC,
        ${base.price !== null ? sql`abs(l.price - ${base.price}::bigint) ASC NULLS LAST,` : sql``}
        l.published_at DESC
      LIMIT 8`;
    return { items: rows.map(toCard) };
  });

  // ── Мои объявления ────────────────────────────────────────────────────────

  app.get("/v1/me/listings", { preHandler: auth }, async (request) => {
    const { user } = authOf(request);
    const { status } = z
      .object({ status: z.enum(["draft", "moderation", "active", "rejected", "sold", "withdrawn", "archived"]).optional() })
      .parse(request.query);
    const rows = await sql<(ListingRow & { favorites: number })[]>`
      ${listingSelect(sql, user.id)}
      WHERE l.user_id = ${user.id} ${status ? sql`AND l.status = ${status}` : sql``}
      ORDER BY l.updated_at DESC
      LIMIT 200`;
    const counts = await sql<{ status: string; count: number }[]>`
      SELECT status, count(*)::int AS count FROM listings WHERE user_id = ${user.id} GROUP BY status`;
    const favorites = await sql<{ listingId: string; count: number }[]>`
      SELECT f.listing_id, count(*)::int AS count FROM favorites f
      JOIN listings l ON l.id = f.listing_id WHERE l.user_id = ${user.id} GROUP BY f.listing_id`;
    const favMap = new Map(favorites.map((f) => [f.listingId, f.count]));
    return {
      items: rows.map((r) => ({
        ...toCard(r),
        status: r.status,
        expiresAt: r.expiresAt?.toISOString() ?? null,
        rejectionReason: r.rejectionReason,
        moderationReason: r.moderationReason,
        favorites: favMap.get(r.id) ?? 0,
        bumpAvailableAt: bumpAvailableAt(r),
      })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c.count])),
    };
  });

  app.get("/v1/me/listings/:id", { preHandler: auth }, async (request) => {
    const { row } = await ownListing(request);
    return toMyListing(ctx, row);
  });

  // Статистика объявления для продавца: просмотры по дням, интерес, место по цене.
  app.get("/v1/me/listings/:id/stats", { preHandler: auth }, async (request): Promise<ListingStatsDto> => {
    const { row } = await ownListing(request);
    const today = mskDay();
    const from = dayMinus(today, LISTING_STATS_DAYS - 1);
    const daily = await sql<{ day: string; views: number }[]>`
      SELECT to_char(day, 'YYYY-MM-DD') AS day, views FROM listing_views_daily
      WHERE listing_id = ${row.id} AND day >= ${from}::date`;
    const byDay = new Map(daily.map((d) => [d.day, d.views]));
    const [counts] = await sql<{ favorites: number; conversations: number; deals: number }[]>`
      SELECT
        (SELECT count(*)::int FROM favorites WHERE listing_id = ${row.id}) AS favorites,
        (SELECT count(*)::int FROM conversations WHERE listing_id = ${row.id}) AS conversations,
        (SELECT count(*)::int FROM deals WHERE listing_id = ${row.id} AND status = 'confirmed') AS deals`;

    let position: ListingStatsDto["position"] = null;
    if (row.catalogItemId !== null && row.operation === "sell" && row.price !== null) {
      const [rank] = await sql<{ total: number; cheaper: number; median: string | null; min: string | null }[]>`
        SELECT count(*)::int AS total,
          count(*) FILTER (WHERE price < ${row.price}::bigint)::int AS cheaper,
          round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price))::bigint AS median,
          min(price) AS min
        FROM listings
        WHERE catalog_item_id = ${row.catalogItemId} AND server_id = ${row.serverId} AND operation = 'sell'
          AND status = 'active' AND expires_at > now() AND price IS NOT NULL AND id <> ${row.id}
          AND ${ownerActive(sql, "listings")}`;
      if (rank && rank.total > 0) {
        position = {
          rank: rank.cheaper + 1,
          total: rank.total + 1,
          median: Number(rank.median),
          min: Math.min(Number(rank.min), Number(row.price)),
        };
      }
    }

    return {
      views: row.views,
      viewsToday: byDay.get(today) ?? 0,
      viewsByDay: dayRange(from, today).map((date) => ({ date, value: byDay.get(date) ?? 0 })),
      favorites: counts?.favorites ?? 0,
      conversations: counts?.conversations ?? 0,
      deals: counts?.deals ?? 0,
      position,
    };
  });

  // Создание — всегда черновик. Публикация отдельным шагом, после загрузки фото.
  app.post("/v1/listings", { preHandler: auth, config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (request, reply) => {
    const { user } = authOf(request);
    const { input, serverId, categoryId } = await validateListing(ctx, user.id, parseBody(listingInputSchema, request.body));

    const [draftCount] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM listings WHERE user_id = ${user.id} AND status = 'draft'`;
    if ((draftCount?.count ?? 0) >= 20) {
      throw errors.conflict("too_many_drafts", "Слишком много черновиков. Опубликуйте или удалите старые.");
    }

    const [created] = await sql<{ id: string }[]>`
      INSERT INTO listings (
        user_id, game_profile_id, server_id, listing_type_id, category_id, catalog_item_id, operation,
        title, description, price, quantity, transfer_mode, deal_places, attributes,
        want_listing_type_id, want_attributes, want_description, surcharge, surcharge_direction
      ) VALUES (
        ${user.id}, ${input.gameProfileId}, ${serverId}, ${input.listingTypeId}::smallint, ${categoryId},
        ${input.catalogItemId}, ${input.operation}, ${input.title}, ${input.description},
        ${input.price}::bigint, ${input.quantity}::int, ${input.transferMode}, ${input.dealPlaces}::text[],
        ${sql.json(input.attributes)}, ${input.wantListingTypeId}::smallint, ${sql.json(input.wantAttributes)},
        ${input.wantDescription}, ${input.surcharge}::bigint, ${input.surchargeDirection}
      )
      RETURNING id`;
    reply.code(201);
    return fresh(created!.id, user.id);
  });

  app.put("/v1/listings/:id", { preHandler: auth }, async (request) => {
    const { user, row } = await ownListing(request);
    if (row.status === "sold") throw errors.conflict("listing_closed", "Проданное объявление нельзя изменить");
    if (row.status === "moderation") throw errors.conflict("on_moderation", "Объявление на проверке — дождитесь решения");
    const { input, serverId, categoryId } = await validateListing(ctx, user.id, parseBody(listingInputSchema, request.body));
    if (input.listingTypeId !== row.listingTypeId) {
      throw errors.validation({ listingTypeId: "Тип имущества нельзя сменить. Создайте новое объявление." });
    }

    await sql.begin(async (tx) => {
      await tx`
        UPDATE listings SET
          game_profile_id = ${input.gameProfileId}, server_id = ${serverId}, category_id = ${categoryId},
          catalog_item_id = ${input.catalogItemId}, operation = ${input.operation}, title = ${input.title},
          description = ${input.description}, price = ${input.price}::bigint, quantity = ${input.quantity}::int,
          transfer_mode = ${input.transferMode}, deal_places = ${input.dealPlaces}::text[],
          attributes = ${sql.json(input.attributes)}, want_listing_type_id = ${input.wantListingTypeId}::smallint,
          want_attributes = ${sql.json(input.wantAttributes)}, want_description = ${input.wantDescription},
          surcharge = ${input.surcharge}::bigint, surcharge_direction = ${input.surchargeDirection},
          updated_at = now()
        WHERE id = ${row.id}`;
      if (row.status === "active" && input.price !== null && String(input.price) !== row.price) {
        await tx`INSERT INTO listing_price_history (listing_id, price) VALUES (${row.id}, ${input.price}::bigint)`;
      }
    });
    // Правка опубликованного объявления проверяется так же, как публикация.
    if (row.status === "active") {
      const flag = await stopWordReason(sql, input.title, input.description, input.wantDescription);
      if (flag) {
        await sql`UPDATE listings SET status = 'moderation', moderation_reason = ${flag}, updated_at = now() WHERE id = ${row.id}`;
      }
    }
    return fresh(row.id, user.id);
  });

  // Публикация (и повторная публикация из архива или снятых).
  app.post("/v1/listings/:id/publish", { preHandler: auth }, async (request) => {
    const { user, row } = await ownListing(request);
    if (!user.emailVerifiedAt) {
      throw new AppError(403, "email_not_verified", "Подтвердите email, чтобы публиковать объявления");
    }
    if (!["draft", "withdrawn", "archived", "rejected"].includes(row.status)) {
      throw errors.conflict("cannot_publish", "Это объявление нельзя опубликовать");
    }
    const [profile] = await sql<{ archivedAt: Date | null }[]>`SELECT archived_at FROM game_profiles WHERE id = ${row.gameProfileId}`;
    if (profile?.archivedAt) throw errors.conflict("profile_archived", "Игровой профиль удалён — выберите другой");

    const [active] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM listings
      WHERE user_id = ${user.id} AND status = 'active' AND expires_at > now()`;
    if ((active?.count ?? 0) >= MAX_ACTIVE_LISTINGS) {
      throw errors.conflict("too_many_active", `Можно держать не больше ${MAX_ACTIVE_LISTINGS} активных объявлений`);
    }

    // Защита от дублей: такое же активное объявление на том же сервере.
    const [duplicate] = await sql<{ id: string }[]>`
      SELECT id FROM listings
      WHERE user_id = ${user.id} AND id <> ${row.id} AND status = 'active' AND expires_at > now()
        AND listing_type_id = ${row.listingTypeId} AND operation = ${row.operation} AND server_id = ${row.serverId}
        AND ${row.catalogItemId !== null ? sql`catalog_item_id = ${row.catalogItemId}` : sql`lower(title) = lower(${row.title})`}
      LIMIT 1`;
    if (duplicate) {
      throw errors.conflict("duplicate_listing", "У вас уже есть такое активное объявление на этом сервере. Измените его или снимите с публикации.");
    }

    // Стоп-слово (например, оплата вне игры) — объявление уходит на проверку модератору.
    const flag = await stopWordReason(sql, row.title, row.description, row.wantDescription);
    if (flag) {
      await sql`
        UPDATE listings SET status = 'moderation', moderation_reason = ${flag}, rejection_reason = NULL, updated_at = now()
        WHERE id = ${row.id}`;
      return fresh(row.id, user.id);
    }

    await sql.begin(async (tx) => {
      await tx`
        UPDATE listings SET status = 'active', published_at = now(), bumped_at = NULL, rejection_reason = NULL,
          expires_at = now() + make_interval(days => ${LISTING_TTL_DAYS}::int), updated_at = now()
        WHERE id = ${row.id}`;
      if (row.price !== null) {
        await tx`INSERT INTO listing_price_history (listing_id, price) VALUES (${row.id}, ${row.price}::bigint)`;
      }
    });
    notifySavedSearchesLater(ctx, row.id, request.log);
    return fresh(row.id, user.id);
  });

  app.post("/v1/listings/:id/extend", { preHandler: auth }, async (request) => {
    const { user, row } = await ownListing(request);
    if (row.status !== "active") throw errors.conflict("not_active", "Продлить можно только активное объявление");
    await sql`
      UPDATE listings SET expires_at = now() + make_interval(days => ${LISTING_TTL_DAYS}::int), updated_at = now()
      WHERE id = ${row.id}`;
    return fresh(row.id, user.id);
  });

  // Поднять наверх «Новых» — раз в сутки. Срок публикации не меняется.
  app.post("/v1/listings/:id/bump", { preHandler: auth }, async (request) => {
    const { user, row } = await ownListing(request);
    if (row.status !== "active" || !row.expiresAt || row.expiresAt.getTime() <= Date.now()) {
      throw errors.conflict("not_active", "Поднять можно только активное объявление");
    }
    const available = bumpAvailableAt(row);
    if (available && new Date(available).getTime() > Date.now()) {
      const hours = Math.max(1, Math.ceil((new Date(available).getTime() - Date.now()) / 3_600_000));
      throw errors.conflict("bump_too_early", `Поднимать можно раз в сутки — снова через ${hours} ч.`);
    }
    await sql`UPDATE listings SET bumped_at = now(), updated_at = now() WHERE id = ${row.id}`;
    return fresh(row.id, user.id);
  });

  app.post("/v1/listings/:id/withdraw", { preHandler: auth }, async (request) => {
    const { user, row } = await ownListing(request);
    if (row.status !== "active") throw errors.conflict("not_active", "Снять можно только активное объявление");
    await sql`UPDATE listings SET status = 'withdrawn', updated_at = now() WHERE id = ${row.id}`;
    return fresh(row.id, user.id);
  });

  app.post("/v1/listings/:id/sold", { preHandler: auth }, async (request) => {
    const { user, row } = await ownListing(request);
    if (!["active", "withdrawn", "archived"].includes(row.status)) {
      throw errors.conflict("cannot_mark_sold", "Это объявление нельзя отметить проданным");
    }
    await sql`UPDATE listings SET status = 'sold', updated_at = now() WHERE id = ${row.id}`;
    return fresh(row.id, user.id);
  });

  // Удалить можно черновик. Опубликованное объявление снимается и остаётся в истории.
  app.delete("/v1/listings/:id", { preHandler: auth }, async (request, reply) => {
    const { row } = await ownListing(request);
    if (row.status !== "draft") {
      throw errors.conflict("cannot_delete", "Удалить можно только черновик. Опубликованное объявление снимите с публикации.");
    }
    await sql`DELETE FROM listings WHERE id = ${row.id}`;
    await removeMediaDir(ctx.uploadDir, `listings/${row.id}`);
    return reply.code(204).send();
  });

  // ── Фотографии ────────────────────────────────────────────────────────────

  app.post(
    "/v1/listings/:id/images",
    { preHandler: auth, config: { rateLimit: { max: 60, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const { row } = await ownListing(request);
      if (row.status === "sold") throw errors.conflict("listing_closed", "Проданное объявление нельзя изменить");

      const [limits] = await sql<{ maxImages: number; count: number }[]>`
        SELECT t.max_images, (SELECT count(*)::int FROM listing_images WHERE listing_id = ${row.id}) AS count
        FROM listing_types t WHERE t.id = ${row.listingTypeId}`;
      if (!limits || limits.count >= limits.maxImages) {
        throw errors.conflict("too_many_images", `Можно загрузить не больше ${limits?.maxImages ?? 0} изображений`);
      }

      const file = await request.file();
      if (!file) throw new AppError(400, "file_required", "Прикрепите изображение");
      const buffer = await file.toBuffer();
      const saved = await saveListingImage(ctx.uploadDir, row.id, buffer);
      await sql`
        INSERT INTO listing_images (listing_id, full_path, thumb_path, width, height, bytes, sort_order, is_main)
        VALUES (
          ${row.id}, ${saved.fullPath}, ${saved.thumbPath}, ${saved.width}::int, ${saved.height}::int, ${saved.bytes}::int,
          ${limits.count}::int, ${limits.count === 0}
        )`;
      await sql`UPDATE listings SET updated_at = now() WHERE id = ${row.id}`;
      reply.code(201);
      return { images: await loadImages(sql, row.id) };
    },
  );

  app.put("/v1/listings/:id/images", { preHandler: auth }, async (request) => {
    const { row } = await ownListing(request);
    const { order, mainId } = parseBody(imageOrderSchema, request.body);
    const current = await loadImages(sql, row.id);
    const ids = new Set(current.map((i) => i.id));
    if (order.length !== ids.size || !order.every((id) => ids.has(id))) {
      throw errors.validation({ order: "Список изображений устарел — обновите страницу" });
    }
    if (mainId !== null && !ids.has(mainId)) throw errors.validation({ mainId: "Изображение не найдено" });

    await sql.begin(async (tx) => {
      for (const [index, id] of order.entries()) {
        await tx`UPDATE listing_images SET sort_order = ${index}::int WHERE id = ${id}`;
      }
      if (mainId !== null) {
        await tx`UPDATE listing_images SET is_main = false WHERE listing_id = ${row.id} AND is_main`;
        await tx`UPDATE listing_images SET is_main = true WHERE id = ${mainId}`;
      }
    });
    return { images: await loadImages(sql, row.id) };
  });

  app.delete("/v1/listings/:id/images/:imageId", { preHandler: auth }, async (request) => {
    const { row } = await ownListing(request);
    const params = z.object({ imageId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) throw errors.notFound("Изображение не найдено");
    const [deleted] = await sql<{ fullPath: string; thumbPath: string; isMain: boolean }[]>`
      DELETE FROM listing_images WHERE id = ${params.data.imageId} AND listing_id = ${row.id}
      RETURNING full_path, thumb_path, is_main`;
    if (!deleted) throw errors.notFound("Изображение не найдено");
    await removeMedia(ctx.uploadDir, [deleted.fullPath, deleted.thumbPath]);
    if (deleted.isMain) {
      // Главным становится первое по порядку.
      await sql`
        UPDATE listing_images SET is_main = true
        WHERE id = (SELECT id FROM listing_images WHERE listing_id = ${row.id} ORDER BY sort_order, created_at LIMIT 1)`;
    }
    return { images: await loadImages(sql, row.id) };
  });

  // ── Избранное ─────────────────────────────────────────────────────────────

  app.post("/v1/listings/:id/favorite", { preHandler: auth }, async (request, reply) => {
    const { user } = authOf(request);
    const params = idParam.safeParse(request.params);
    if (!params.success) throw notOwner();
    const [listing] = await sql`SELECT 1 FROM listings WHERE id = ${params.data.id} AND status = 'active'`;
    if (!listing) throw notOwner();
    await sql`INSERT INTO favorites (user_id, listing_id) VALUES (${user.id}, ${params.data.id}) ON CONFLICT DO NOTHING`;
    return reply.code(204).send();
  });

  app.delete("/v1/listings/:id/favorite", { preHandler: auth }, async (request, reply) => {
    const { user } = authOf(request);
    const params = idParam.safeParse(request.params);
    if (!params.success) throw notOwner();
    await sql`DELETE FROM favorites WHERE user_id = ${user.id} AND listing_id = ${params.data.id}`;
    return reply.code(204).send();
  });

  app.get("/v1/me/favorites", { preHandler: auth }, async (request): Promise<{ items: Array<ListingCardDto & { status: string }> }> => {
    const { user } = authOf(request);
    const rows = await sql<ListingRow[]>`
      ${listingSelect(sql, user.id)}
      JOIN favorites fav ON fav.listing_id = l.id AND fav.user_id = ${user.id}
      ORDER BY fav.created_at DESC
      LIMIT 200`;
    return {
      items: rows.map((r) => ({
        ...toCard(r),
        status: r.status === "active" && r.expiresAt && r.expiresAt.getTime() <= Date.now() ? "archived" : r.status,
      })),
    };
  });
}
