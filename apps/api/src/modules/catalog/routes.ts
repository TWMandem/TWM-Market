import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AttributeDefinitionDto, CatalogItemOptionDto, CategoryDto, ListingTypeDto, SectionDto } from "@twm/shared";
import type { AppContext } from "../../context.js";
import { mediaUrl } from "../../lib/media.js";

/**
 * Публичная структура площадки для приложения: активные разделы, типы
 * имущества, категории и поля характеристик. Скрытые в админке записи
 * сюда не попадают.
 */
export async function catalogRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;

  app.get(
    "/v1/catalog",
    async (): Promise<{ sections: SectionDto[]; listingTypes: ListingTypeDto[]; categories: CategoryDto[] }> => {
      const sections = await sql<SectionDto[]>`
        SELECT id, code, name, description, is_active, sort_order FROM sections
        WHERE is_active ORDER BY sort_order, id`;
      const listingTypes = await sql<ListingTypeDto[]>`
        SELECT t.id, s.code AS section_code, t.code, t.name, t.operations, t.max_images, t.is_active, t.sort_order
        FROM listing_types t JOIN sections s ON s.id = t.section_id
        WHERE t.is_active AND s.is_active
        ORDER BY s.sort_order, t.sort_order, t.id`;
      const categories = await sql<CategoryDto[]>`
        SELECT c.id, s.code AS section_code, c.parent_id, c.name, c.is_active, c.sort_order,
               (SELECT count(*)::int FROM catalog_items i WHERE i.category_id = c.id AND i.is_active) AS items_count
        FROM categories c
        JOIN sections s ON s.id = c.section_id
        LEFT JOIN categories p ON p.id = c.parent_id
        WHERE c.is_active AND s.is_active AND (p.id IS NULL OR p.is_active)
        ORDER BY s.sort_order, c.parent_id NULLS FIRST, c.sort_order, c.name`;
      return { sections: [...sections], listingTypes: [...listingTypes], categories: [...categories] };
    },
  );

  app.get("/v1/catalog/attributes", async (request): Promise<{ items: AttributeDefinitionDto[] }> => {
    const { listingTypeId } = z.object({ listingTypeId: z.coerce.number().int().positive() }).parse(request.query);
    const rows = await sql<(Omit<AttributeDefinitionDto, "minValue" | "maxValue"> & { minValue: string | null; maxValue: string | null })[]>`
      SELECT id, listing_type_id, key, label, data_type, unit, options, min_value, max_value,
             required, filterable, applies_to, help_text, is_active, sort_order
      FROM attribute_definitions
      WHERE listing_type_id = ${listingTypeId}::smallint AND is_active
      ORDER BY sort_order, id`;
    return {
      items: rows.map((r) => ({
        ...r,
        minValue: r.minValue === null ? null : Number(r.minValue),
        maxValue: r.maxValue === null ? null : Number(r.maxValue),
      })),
    };
  });

  // Предметы справочника для выбора в форме объявления и фильтра каталога.
  app.get("/v1/catalog/items", async (request): Promise<{ items: CatalogItemOptionDto[] }> => {
    const q = z
      .object({ categoryId: z.coerce.number().int().positive().optional(), q: z.string().trim().max(80).optional() })
      .parse(request.query);
    const like = q.q ? `%${q.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const rows = await sql<
      { id: number; categoryId: number; name: string; aliases: string[]; iconPath: string | null; iconKind: "image" | "video" | null }[]
    >`
      SELECT i.id, i.category_id, i.name, i.aliases, i.icon_path, i.icon_kind
      FROM catalog_items i JOIN categories c ON c.id = i.category_id
      WHERE i.is_active AND c.is_active
        ${q.categoryId ? sql`AND i.category_id = ${q.categoryId}` : sql``}
        ${like ? sql`AND (lower(i.name) LIKE ${like} OR EXISTS (SELECT 1 FROM unnest(i.aliases) a WHERE lower(a) LIKE ${like}))` : sql``}
      ORDER BY i.sort_order, i.name
      LIMIT 500`;
    return {
      items: rows.map((r) => ({
        id: r.id,
        categoryId: r.categoryId,
        name: r.name,
        aliases: r.aliases,
        icon: r.iconPath && r.iconKind ? { url: mediaUrl(r.iconPath), kind: r.iconKind } : null,
      })),
    };
  });
}
