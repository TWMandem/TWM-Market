import {
  buildAttributesSchema,
  fieldErrors,
  type AttributeDefinitionDto,
  type ListingAttributeDto,
  type ListingCardDto,
  type ListingDetailDto,
  type ListingImageDto,
  type ListingInput,
  type MediaDto,
  type MyListingDto,
  type PriceStatsDto,
  type SectionCode,
} from "@twm/shared";
import type { AppContext } from "../../context.js";
import type { Fragment, Sql } from "../../db/client.js";
import { AppError, errors } from "../../lib/errors.js";
import { mediaUrl } from "../../lib/media.js";

type AttrValue = string | number | boolean | string[];

/** Строка объявления со всем, что нужно для карточки. */
export interface ListingRow {
  id: string;
  userId: string;
  gameProfileId: string;
  serverId: number;
  listingTypeId: number;
  categoryId: number | null;
  catalogItemId: number | null;
  operation: "sell" | "buy" | "exchange";
  title: string;
  description: string;
  /** bigint из базы приходит строкой */
  price: string | null;
  quantity: number;
  transferMode: "none" | "seller_moves" | "buyer_moves";
  dealPlaces: Array<"car_market" | "notary">;
  attributes: Record<string, AttrValue>;
  wantListingTypeId: number | null;
  wantAttributes: Record<string, AttrValue>;
  wantDescription: string;
  surcharge: string | null;
  surchargeDirection: "i_pay" | "they_pay" | null;
  status: ListingDetailDto["status"];
  rejectionReason: string | null;
  views: number;
  publishedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sectionCode: SectionCode;
  typeCode: string;
  typeName: string;
  serverNumber: number;
  serverName: string;
  serverColor: string;
  sellerNickname: string;
  mainThumb: string | null;
  itemName: string | null;
  itemIconPath: string | null;
  itemIconKind: "image" | "video" | null;
  categoryName: string | null;
  favorite: boolean;
  avgPrice: string | null;
  avgCount: number;
}

/**
 * Общая часть выборки объявлений. viewerId нужен, чтобы отметить избранное.
 * Средняя цена считается по другим активным объявлениям о продаже того же
 * предмета на том же сервере.
 */
export function listingSelect(sql: Sql, viewerId: string | null): Fragment {
  return sql`
    SELECT
      l.id, l.user_id, l.game_profile_id, l.server_id, l.listing_type_id, l.category_id, l.catalog_item_id,
      l.operation, l.title, l.description, l.price, l.quantity, l.transfer_mode, l.deal_places, l.attributes,
      l.want_listing_type_id, l.want_attributes, l.want_description, l.surcharge, l.surcharge_direction,
      l.status, l.rejection_reason, l.views, l.published_at, l.expires_at, l.created_at, l.updated_at,
      s.code AS section_code, t.code AS type_code, t.name AS type_name,
      sv.number AS server_number, sv.name AS server_name, sv.color AS server_color,
      gp.nickname AS seller_nickname,
      mi.thumb_path AS main_thumb,
      ci.name AS item_name, ci.icon_path AS item_icon_path, ci.icon_kind AS item_icon_kind,
      c.name AS category_name,
      ${viewerId ? sql`EXISTS (SELECT 1 FROM favorites f WHERE f.listing_id = l.id AND f.user_id = ${viewerId})` : sql`false`} AS favorite,
      ps.avg_price, COALESCE(ps.avg_count, 0)::int AS avg_count
    FROM listings l
    JOIN listing_types t ON t.id = l.listing_type_id
    JOIN sections s ON s.id = t.section_id
    JOIN servers sv ON sv.id = l.server_id
    JOIN game_profiles gp ON gp.id = l.game_profile_id
    LEFT JOIN catalog_items ci ON ci.id = l.catalog_item_id
    LEFT JOIN categories c ON c.id = l.category_id
    LEFT JOIN LATERAL (
      SELECT i.thumb_path FROM listing_images i
      WHERE i.listing_id = l.id ORDER BY i.is_main DESC, i.sort_order, i.created_at LIMIT 1
    ) mi ON true
    LEFT JOIN LATERAL (
      SELECT round(avg(o.price))::bigint AS avg_price, count(*)::int AS avg_count
      FROM listings o
      WHERE l.catalog_item_id IS NOT NULL AND o.catalog_item_id = l.catalog_item_id
        AND o.server_id = l.server_id AND o.operation = 'sell' AND o.status = 'active'
        AND o.expires_at > now() AND o.id <> l.id
    ) ps ON true`;
}

const num = (value: string | null): number | null => (value === null ? null : Number(value));

function icon(row: Pick<ListingRow, "itemIconPath" | "itemIconKind">): MediaDto | null {
  return row.itemIconPath && row.itemIconKind ? { url: mediaUrl(row.itemIconPath), kind: row.itemIconKind } : null;
}

export function toCard(row: ListingRow): ListingCardDto {
  const price = num(row.price);
  const avg = num(row.avgPrice);
  return {
    id: row.id,
    sectionCode: row.sectionCode,
    listingType: { id: row.listingTypeId, code: row.typeCode, name: row.typeName },
    operation: row.operation,
    title: row.title,
    price,
    quantity: row.quantity,
    server: { number: row.serverNumber, name: row.serverName, color: row.serverColor },
    transferMode: row.transferMode,
    sellerNickname: row.sellerNickname,
    image: row.mainThumb ? { url: mediaUrl(row.mainThumb), kind: "image" } : icon(row),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    views: row.views,
    favorite: row.favorite,
    // «Ниже средней» показываем, только если есть хотя бы 3 других предложения.
    belowAverage:
      row.operation === "sell" && price !== null && avg !== null && row.avgCount >= 3 && price < avg * 0.9,
  };
}

// ── Описания полей ─────────────────────────────────────────────────────────

interface AttributeRow extends Omit<AttributeDefinitionDto, "minValue" | "maxValue"> {
  minValue: string | null;
  maxValue: string | null;
}

export async function loadDefinitions(sql: Sql, listingTypeId: number): Promise<AttributeDefinitionDto[]> {
  const rows = await sql<AttributeRow[]>`
    SELECT id, listing_type_id, key, label, data_type, unit, options, min_value, max_value,
           required, filterable, applies_to, help_text, is_active, sort_order
    FROM attribute_definitions WHERE listing_type_id = ${listingTypeId}::smallint
    ORDER BY sort_order, id`;
  return rows.map((r) => ({ ...r, minValue: num(r.minValue), maxValue: num(r.maxValue) }));
}

/** Значения характеристик с подписями — в порядке полей из конструктора. */
export function renderAttributes(
  values: Record<string, AttrValue>,
  definitions: AttributeDefinitionDto[],
  side: "offer" | "want",
): ListingAttributeDto[] {
  const result: ListingAttributeDto[] = [];
  for (const def of definitions) {
    if (def.appliesTo !== "both" && def.appliesTo !== side) continue;
    const value = values[def.key];
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    result.push({ key: def.key, label: def.label, value, unit: def.unit });
  }
  return result;
}

// ── Проверка данных от продавца ────────────────────────────────────────────

export interface ValidatedListing {
  input: ListingInput;
  serverId: number;
  categoryId: number | null;
  sectionCode: SectionCode;
}

/**
 * Проверяет объявление по правилам раздела и типа имущества:
 * свой игровой профиль, допустимая операция, предмет из справочника,
 * характеристики по описаниям полей.
 */
export async function validateListing(ctx: AppContext, userId: string, input: ListingInput): Promise<ValidatedListing> {
  const sql = ctx.sql;

  const [profile] = await sql<{ serverId: number; archivedAt: Date | null }[]>`
    SELECT server_id, archived_at FROM game_profiles WHERE id = ${input.gameProfileId} AND user_id = ${userId}`;
  if (!profile || profile.archivedAt) throw errors.validation({ gameProfileId: "Игровой профиль не найден" });

  const [type] = await sql<{ sectionCode: SectionCode; operations: string[]; isActive: boolean }[]>`
    SELECT s.code AS section_code, t.operations, t.is_active AND s.is_active AS is_active
    FROM listing_types t JOIN sections s ON s.id = t.section_id
    WHERE t.id = ${input.listingTypeId}::smallint`;
  if (!type || !type.isActive) throw errors.validation({ listingTypeId: "Тип имущества не найден" });
  if (!type.operations.includes(input.operation)) {
    throw errors.validation({ operation: "Для этого типа имущества такая операция недоступна" });
  }

  let categoryId: number | null = null;
  const fields: Record<string, string> = {};
  const data: ListingInput = { ...input };

  if (input.catalogItemId !== null) {
    const [item] = await sql<{ name: string; categoryId: number; sectionCode: SectionCode }[]>`
      SELECT i.name, i.category_id, s.code AS section_code
      FROM catalog_items i JOIN categories c ON c.id = i.category_id JOIN sections s ON s.id = c.section_id
      WHERE i.id = ${input.catalogItemId} AND i.is_active AND c.is_active`;
    if (!item || item.sectionCode !== type.sectionCode) {
      fields.catalogItemId = "Предмет не найден в справочнике";
    } else {
      categoryId = item.categoryId;
      if (!data.title) data.title = item.name;
    }
  } else if (type.sectionCode === "items") {
    fields.catalogItemId = "Выберите предмет из справочника";
  }

  if (data.title.length < 3) fields.title = "Название — от 3 символов";
  if (type.sectionCode !== "items") data.quantity = 1;
  if (type.sectionCode !== "cars") data.dealPlaces = [];

  const definitions = await loadDefinitions(sql, input.listingTypeId);
  const offer = buildAttributesSchema(definitions, "offer").safeParse(input.attributes);
  if (offer.success) data.attributes = offer.data;
  else for (const [key, message] of Object.entries(fieldErrors(offer.error))) fields[`attributes.${key}`] = message;

  if (input.operation === "exchange") {
    if (input.wantListingTypeId !== null) {
      const [wantType] = await sql`SELECT 1 FROM listing_types WHERE id = ${input.wantListingTypeId}::smallint AND is_active`;
      if (!wantType) fields.wantListingTypeId = "Тип имущества не найден";
    }
    const want = buildAttributesSchema(definitions, "want").safeParse(input.wantAttributes);
    if (want.success) data.wantAttributes = want.data;
    else for (const [key, message] of Object.entries(fieldErrors(want.error))) fields[`wantAttributes.${key}`] = message;
  } else {
    data.wantListingTypeId = null;
    data.wantAttributes = {};
    data.wantDescription = "";
    data.surcharge = null;
    data.surchargeDirection = null;
  }

  if (Object.keys(fields).length > 0) throw errors.validation(fields);
  return { input: data, serverId: profile.serverId, categoryId, sectionCode: type.sectionCode };
}

// ── Карточка объявления ────────────────────────────────────────────────────

export async function loadListingRow(sql: Sql, id: string, viewerId: string | null): Promise<ListingRow | undefined> {
  const [row] = await sql<ListingRow[]>`${listingSelect(sql, viewerId)} WHERE l.id = ${id}`;
  return row;
}

export async function loadImages(sql: Sql, listingId: string): Promise<ListingImageDto[]> {
  const rows = await sql<
    { id: string; fullPath: string; thumbPath: string; width: number; height: number; isMain: boolean }[]
  >`
    SELECT id, full_path, thumb_path, width, height, is_main FROM listing_images
    WHERE listing_id = ${listingId} ORDER BY sort_order, created_at`;
  return rows.map((r) => ({
    id: r.id,
    fullUrl: mediaUrl(r.fullPath),
    thumbUrl: mediaUrl(r.thumbPath),
    width: r.width,
    height: r.height,
    isMain: r.isMain,
  }));
}

async function priceStats(sql: Sql, row: ListingRow): Promise<PriceStatsDto | null> {
  if (row.catalogItemId === null) return null;
  const [stats] = await sql<{ count: number; average: string; median: string; min: string; max: string }[]>`
    SELECT count(*)::int AS count, round(avg(price))::bigint AS average,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price))::bigint AS median,
           min(price) AS min, max(price) AS max
    FROM listings
    WHERE catalog_item_id = ${row.catalogItemId} AND server_id = ${row.serverId}
      AND operation = 'sell' AND status = 'active' AND expires_at > now() AND id <> ${row.id}`;
  if (!stats || stats.count < 2) return null;
  return {
    count: stats.count,
    average: Number(stats.average),
    median: Number(stats.median),
    min: Number(stats.min),
    max: Number(stats.max),
  };
}

export async function toDetail(ctx: AppContext, row: ListingRow, viewerId: string | null): Promise<ListingDetailDto> {
  const sql = ctx.sql;
  const definitions = await loadDefinitions(sql, row.listingTypeId);
  const [seller] = await sql<
    { login: string; createdAt: Date; verifiedAt: Date | null; sameNick: number; activeListings: number }[]
  >`
    SELECT u.login, u.created_at, gp.verified_at,
      (SELECT count(DISTINCT o.user_id)::int FROM game_profiles o
        WHERE o.server_id = gp.server_id AND lower(o.nickname) = lower(gp.nickname) AND o.user_id <> gp.user_id) AS same_nick,
      (SELECT count(*)::int FROM listings a
        WHERE a.user_id = u.id AND a.status = 'active' AND a.expires_at > now()) AS active_listings
    FROM users u JOIN game_profiles gp ON gp.id = ${row.gameProfileId}
    WHERE u.id = ${row.userId}`;

  let wantTypeName: string | null = null;
  if (row.wantListingTypeId !== null) {
    const [wantType] = await sql<{ name: string }[]>`SELECT name FROM listing_types WHERE id = ${row.wantListingTypeId}`;
    wantTypeName = wantType?.name ?? null;
  }

  return {
    ...toCard(row),
    status: row.status,
    description: row.description,
    category: row.categoryId !== null && row.categoryName ? { id: row.categoryId, name: row.categoryName } : null,
    catalogItem:
      row.catalogItemId !== null && row.itemName ? { id: row.catalogItemId, name: row.itemName, icon: icon(row) } : null,
    images: await loadImages(sql, row.id),
    attributes: renderAttributes(row.attributes, definitions, "offer"),
    dealPlaces: row.dealPlaces,
    want:
      row.operation === "exchange"
        ? {
            listingType: row.wantListingTypeId !== null && wantTypeName ? { id: row.wantListingTypeId, name: wantTypeName } : null,
            attributes: renderAttributes(row.wantAttributes, definitions, "want"),
            description: row.wantDescription,
            surcharge: num(row.surcharge),
            surchargeDirection: row.surchargeDirection,
          }
        : null,
    seller: {
      login: seller?.login ?? "",
      memberSince: seller?.createdAt.toISOString() ?? row.createdAt.toISOString(),
      nickname: row.sellerNickname,
      nicknameVerified: seller?.verifiedAt != null,
      sameNicknameCount: seller?.sameNick ?? 0,
      activeListings: seller?.activeListings ?? 0,
    },
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isOwner: viewerId === row.userId,
    priceStats: await priceStats(sql, row),
    rejectionReason: row.rejectionReason,
  };
}

export async function toMyListing(ctx: AppContext, row: ListingRow): Promise<MyListingDto> {
  const [fav] = await ctx.sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM favorites WHERE listing_id = ${row.id}`;
  return {
    ...(await toDetail(ctx, row, row.userId)),
    gameProfileId: row.gameProfileId,
    categoryId: row.categoryId,
    rawAttributes: row.attributes,
    rawWantAttributes: row.wantAttributes,
    wantListingTypeId: row.wantListingTypeId,
    favorites: fav?.count ?? 0,
  };
}

/** Объявления с истёкшим сроком уходят в архив. Запускается по таймеру. */
export async function archiveExpired(sql: Sql): Promise<number> {
  const result = await sql`
    UPDATE listings SET status = 'archived', updated_at = now()
    WHERE status = 'active' AND expires_at <= now()`;
  return result.count;
}

export function notOwner(): AppError {
  return errors.notFound("Объявление не найдено");
}
