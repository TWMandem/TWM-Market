import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AttributeDefinitionDto, CategoryDto, ListingTypeDto, SectionDto } from "@twm/shared";
import type { AppContext } from "../../context.js";

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
}
