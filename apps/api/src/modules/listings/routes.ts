import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  LISTING_PERIODS,
  LISTING_SORTS,
  LISTING_TTL_DAYS,
  MAX_ACTIVE_LISTINGS,
  imageOrderSchema,
  listingInputSchema,
  type ListingCardDto,
  type ListingSearchResultDto,
} from "@twm/shared";
import type { AppContext } from "../../context.js";
import type { Fragment } from "../../db/client.js";
import { AppError, errors, parseBody } from "../../lib/errors.js";
import { removeMedia, removeMediaDir, saveListingImage } from "../../lib/media.js";
import { authOf, hasRole, optionalAuth, requireAuth } from "../auth/guard.js";
import {
  listingSelect,
  loadDefinitions,
  loadImages,
  loadListingRow,
  notOwner,
  toCard,
  toDetail,
  toMyListing,
  validateListing,
  type ListingRow,
} from "./service.js";

const idParam = z.object({ id: z.string().uuid() });
const PAGE_SIZE = 24;

const searchQuery = z.object({
  section: z.enum(["items", "cars", "notary"]).optional(),
  type: z.coerce.number().int().positive().optional(),
  category: z.coerce.number().int().positive().optional(),
  item: z.coerce.number().int().positive().optional(),
  operation: z.enum(["sell", "buy", "exchange"]).optional(),
  server: z.coerce.number().int().positive().optional(),
  /** Показать предложения с других серверов, где возможен перевод. */
  transfer: z.enum(["1", "true"]).optional(),
  priceMin: z.coerce.number().int().min(0).optional(),
  priceMax: z.coerce.number().int().min(0).optional(),
  q: z.string().trim().max(100).optional(),
  nick: z.string().trim().max(40).optional(),
  period: z.enum(LISTING_PERIODS).optional(),
  dealPlace: z.enum(["car_market", "notary"]).optional(),
  sort: z.enum(LISTING_SORTS).default("new"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

const likePattern = (text: string) => `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const PERIOD_INTERVAL = { "1d": "1 day", "7d": "7 days", "30d": "30 days" } as const;

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

    // Фильтры по характеристикам: a.<ключ>=значение, a.<ключ>.min / .max для чисел.
    const definitions = q.type ? (await loadDefinitions(sql, q.type)).filter((d) => d.filterable && d.isActive) : [];

    const where = (): Fragment => {
      const c: Fragment[] = [sql`l.status = 'active'`, sql`l.expires_at > now()`, sql`s.is_active`, sql`t.is_active`];
      if (q.section) c.push(sql`s.code = ${q.section}`);
      if (q.type) c.push(sql`l.listing_type_id = ${q.type}::smallint`);
      if (q.category) {
        c.push(sql`(l.category_id = ${q.category} OR l.category_id IN (SELECT id FROM categories WHERE parent_id = ${q.category}))`);
      }
      if (q.item) c.push(sql`l.catalog_item_id = ${q.item}`);
      if (q.operation) c.push(sql`l.operation = ${q.operation}`);
      if (q.server) {
        c.push(
          q.transfer
            ? sql`(sv.number = ${q.server}::smallint OR l.transfer_mode <> 'none')`
            : sql`sv.number = ${q.server}::smallint`,
        );
      }
      if (q.priceMin !== undefined) c.push(sql`l.price >= ${q.priceMin}::bigint`);
      if (q.priceMax !== undefined) c.push(sql`l.price <= ${q.priceMax}::bigint`);
      if (q.period) c.push(sql`l.published_at > now() - ${PERIOD_INTERVAL[q.period]}::interval`);
      if (q.dealPlace) c.push(sql`${q.dealPlace} = ANY(l.deal_places)`);
      if (q.nick) c.push(sql`lower(gp.nickname) LIKE ${likePattern(q.nick)}`);
      if (q.q) {
        const like = likePattern(q.q);
        c.push(sql`(
          l.search_vector @@ websearch_to_tsquery('russian', ${q.q})
          OR lower(l.title) LIKE ${like}
          OR lower(gp.nickname) = lower(${q.q})
          OR EXISTS (SELECT 1 FROM unnest(ci.aliases) a WHERE lower(a) LIKE ${like})
        )`);
      }
      for (const def of definitions) {
        const key = def.key;
        if (def.dataType === "number") {
          const min = Number(raw[`a.${key}.min`]);
          const max = Number(raw[`a.${key}.max`]);
          const value = sql`(CASE WHEN jsonb_typeof(l.attributes -> ${key}) = 'number' THEN (l.attributes ->> ${key})::numeric END)`;
          if (raw[`a.${key}.min`] && Number.isFinite(min)) c.push(sql`${value} >= ${min}::numeric`);
          if (raw[`a.${key}.max`] && Number.isFinite(max)) c.push(sql`${value} <= ${max}::numeric`);
        } else {
          const value = raw[`a.${key}`];
          if (!value) continue;
          if (def.dataType === "multiselect") c.push(sql`jsonb_exists(l.attributes -> ${key}, ${value})`);
          else if (def.dataType === "boolean") c.push(sql`(l.attributes ->> ${key}) = ${value === "true" ? "true" : "false"}`);
          else c.push(sql`(l.attributes ->> ${key}) = ${value}`);
        }
      }
      return c.reduce((acc, cond, i) => (i === 0 ? sql`WHERE ${cond}` : sql`${acc} AND ${cond}`), sql``);
    };

    const order = () => {
      switch (q.sort) {
        case "price_asc":
          return sql`ORDER BY l.price ASC NULLS LAST, l.published_at DESC`;
        case "price_desc":
          return sql`ORDER BY l.price DESC NULLS LAST, l.published_at DESC`;
        case "popular":
          return sql`ORDER BY l.views DESC, l.published_at DESC`;
        default:
          return sql`ORDER BY l.published_at DESC`;
      }
    };

    const [count] = await sql<{ total: number }[]>`
      SELECT count(*)::int AS total
      FROM listings l
      JOIN listing_types t ON t.id = l.listing_type_id
      JOIN sections s ON s.id = t.section_id
      JOIN servers sv ON sv.id = l.server_id
      JOIN game_profiles gp ON gp.id = l.game_profile_id
      LEFT JOIN catalog_items ci ON ci.id = l.catalog_item_id
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

    const isPublic = row.status === "active" && row.expiresAt !== null && row.expiresAt.getTime() > Date.now();
    const canSeeHidden = viewer !== null && (viewer.id === row.userId || hasRole(viewer.role, "moderator"));
    if (!isPublic && !canSeeHidden) throw notOwner();

    // Просмотры владельца не считаются.
    if (isPublic && viewer?.id !== row.userId) {
      await sql`UPDATE listings SET views = views + 1 WHERE id = ${row.id}`;
      row.views += 1;
    }
    return toDetail(ctx, row, viewer?.id ?? null);
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
        favorites: favMap.get(r.id) ?? 0,
      })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c.count])),
    };
  });

  app.get("/v1/me/listings/:id", { preHandler: auth }, async (request) => {
    const { row } = await ownListing(request);
    return toMyListing(ctx, row);
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
    return fresh(row.id, user.id);
  });

  // Публикация (и повторная публикация из архива или снятых).
  app.post("/v1/listings/:id/publish", { preHandler: auth }, async (request) => {
    const { user, row } = await ownListing(request);
    if (!user.emailVerifiedAt) {
      throw new AppError(403, "email_not_verified", "Подтвердите email, чтобы публиковать объявления");
    }
    if (!["draft", "withdrawn", "archived"].includes(row.status)) {
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

    await sql.begin(async (tx) => {
      await tx`
        UPDATE listings SET status = 'active', published_at = now(),
          expires_at = now() + make_interval(days => ${LISTING_TTL_DAYS}::int), updated_at = now()
        WHERE id = ${row.id}`;
      if (row.price !== null) {
        await tx`INSERT INTO listing_price_history (listing_id, price) VALUES (${row.id}, ${row.price}::bigint)`;
      }
    });
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
