import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  attributeCreateSchema,
  attributeUpdateSchema,
  catalogItemCreateSchema,
  catalogItemUpdateSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  listingTypeCreateSchema,
  listingTypeUpdateSchema,
  sectionUpdateSchema,
  serverCreateSchema,
  serverUpdateSchema,
  type AttributeDefinitionDto,
  type CatalogItemDto,
  type CategoryDto,
  type ListingTypeDto,
  type SectionDto,
  type ServerDto,
} from "@twm/shared";
import type { AppContext } from "../../context.js";
import type { Fragment } from "../../db/client.js";
import { uniqueViolation } from "../../db/client.js";
import type { ServerRow } from "../../db/types.js";
import { writeAudit } from "../../lib/audit.js";
import { mediaUrl, removeMedia, removeMediaDir, saveIcon } from "../../lib/media.js";
import { errors, parseBody } from "../../lib/errors.js";
import { requireStaff } from "../auth/guard.js";
import { toServerDto } from "../servers/routes.js";
import { attributeColumns, toAttributeDto, type AttributeRow } from "../catalog/attribute-row.js";

type SectionCode = "items" | "cars" | "notary";

const numId = z.object({ id: z.coerce.number().int().positive() });
const sectionParam = z.object({ code: z.enum(["items", "cars", "notary"]) });
const serverParam = z.object({ number: z.coerce.number().int().positive() });

function parseParams<S extends z.ZodTypeAny>(schema: S, request: FastifyRequest, what: string): z.infer<S> {
  const parsed = schema.safeParse(request.params);
  if (!parsed.success) throw errors.notFound(`${what} не найден`);
  return parsed.data;
}

/** Убирает ключи со значением undefined, чтобы обновлять только переданные поля. */
function definedOnly<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ── Строки базы и их представление в API ───────────────────────────────────

interface ListingTypeRow {
  id: number;
  sectionCode: SectionCode;
  code: string;
  name: string;
  operations: ListingTypeDto["operations"];
  maxImages: number;
  isActive: boolean;
  sortOrder: number;
}

interface CategoryRow {
  id: number;
  sectionCode: SectionCode;
  parentId: number | null;
  name: string;
  isActive: boolean;
  sortOrder: number;
  itemsCount: number;
}

interface CatalogItemRow {
  id: number;
  categoryId: number;
  name: string;
  aliases: string[];
  isActive: boolean;
  sortOrder: number;
  iconPath: string | null;
  iconKind: "image" | "video" | null;
}

const toItemDto = (row: CatalogItemRow): CatalogItemDto => ({
  id: row.id,
  categoryId: row.categoryId,
  name: row.name,
  aliases: row.aliases,
  isActive: row.isActive,
  sortOrder: row.sortOrder,
  icon: row.iconPath && row.iconKind ? { url: mediaUrl(row.iconPath), kind: row.iconKind } : null,
});

const ITEM_COLUMNS = "id, category_id, name, aliases, is_active, sort_order, icon_path, icon_kind";

export async function adminCatalogRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;
  const read = { preHandler: requireStaff(ctx, "moderator") };
  const write = { preHandler: requireStaff(ctx, "admin") };

  const sectionId = async (code: SectionCode): Promise<number> => {
    const [row] = await sql<{ id: number }[]>`SELECT id FROM sections WHERE code = ${code}`;
    if (!row) throw errors.validation({ sectionCode: "Раздел не найден" });
    return row.id;
  };

  // ── Серверы ───────────────────────────────────────────────────────────────

  app.get("/v1/admin/servers", read, async (): Promise<{ items: ServerDto[] }> => {
    const rows = await sql<ServerRow[]>`SELECT * FROM servers ORDER BY sort_order, number`;
    return { items: rows.map(toServerDto) };
  });

  app.post("/v1/admin/servers", write, async (request, reply) => {
    const input = parseBody(serverCreateSchema, request.body);
    try {
      const [row] = await sql<ServerRow[]>`
        INSERT INTO servers (number, name, color, is_active, transfer_open, sort_order)
        VALUES (${input.number}::smallint, ${input.name}, ${input.color}, ${input.isActive}, ${input.transferOpen}, ${input.sortOrder}::int)
        RETURNING *`;
      await writeAudit(ctx, request, "server.created", { type: "server", id: input.number }, input);
      reply.code(201);
      return toServerDto(row!);
    } catch (error) {
      if (uniqueViolation(error) !== null) {
        throw errors.conflict("duplicate_server", "Сервер с таким номером или названием уже есть", {
          number: "Номер или название заняты",
        });
      }
      throw error;
    }
  });

  app.patch("/v1/admin/servers/:number", write, async (request) => {
    const { number } = parseParams(serverParam, request, "Сервер");
    const patch = definedOnly(parseBody(serverUpdateSchema, request.body));
    if (Object.keys(patch).length === 0) throw errors.validation({ _: "Нет изменений" });
    try {
      const [row] = await sql<ServerRow[]>`
        UPDATE servers SET ${sql(patch)}, updated_at = now()
        WHERE number = ${number}::smallint
        RETURNING *`;
      if (!row) throw errors.notFound("Сервер не найден");
      await writeAudit(ctx, request, "server.updated", { type: "server", id: number }, patch);
      return toServerDto(row);
    } catch (error) {
      if (uniqueViolation(error) !== null) {
        throw errors.conflict("duplicate_server", "Сервер с таким названием уже есть", { name: "Название занято" });
      }
      throw error;
    }
  });

  // ── Разделы ───────────────────────────────────────────────────────────────

  app.get("/v1/admin/sections", read, async (): Promise<{ items: SectionDto[] }> => {
    const rows = await sql<SectionDto[]>`
      SELECT id, code, name, description, is_active, sort_order FROM sections ORDER BY sort_order, id`;
    return { items: [...rows] };
  });

  app.patch("/v1/admin/sections/:code", write, async (request): Promise<SectionDto> => {
    const { code } = parseParams(sectionParam, request, "Раздел");
    const patch = definedOnly(parseBody(sectionUpdateSchema, request.body));
    if (Object.keys(patch).length === 0) throw errors.validation({ _: "Нет изменений" });
    const [row] = await sql<SectionDto[]>`
      UPDATE sections SET ${sql(patch)}, updated_at = now()
      WHERE code = ${code}
      RETURNING id, code, name, description, is_active, sort_order`;
    if (!row) throw errors.notFound("Раздел не найден");
    await writeAudit(ctx, request, "section.updated", { type: "section", id: code }, patch);
    return row;
  });

  // ── Типы имущества ────────────────────────────────────────────────────────

  const listingTypeSelect = () => sql`
    SELECT t.id, s.code AS section_code, t.code, t.name, t.operations, t.max_images, t.is_active, t.sort_order
    FROM listing_types t JOIN sections s ON s.id = t.section_id`;

  app.get("/v1/admin/listing-types", read, async (): Promise<{ items: ListingTypeDto[] }> => {
    const rows = await sql<ListingTypeRow[]>`${listingTypeSelect()} ORDER BY s.sort_order, t.sort_order, t.id`;
    return { items: [...rows] };
  });

  app.post("/v1/admin/listing-types", write, async (request, reply): Promise<ListingTypeDto> => {
    const input = parseBody(listingTypeCreateSchema, request.body);
    const section = await sectionId(input.sectionCode);
    let id: number | undefined;
    try {
      const [row] = await sql<{ id: number }[]>`
        INSERT INTO listing_types (section_id, code, name, operations, max_images, is_active, sort_order)
        VALUES (${section}, ${input.code}, ${input.name}, ${input.operations}::text[], ${input.maxImages}::smallint,
                ${input.isActive}, ${input.sortOrder}::int)
        RETURNING id`;
      id = row?.id;
    } catch (error) {
      if (uniqueViolation(error) !== null) {
        throw errors.conflict("duplicate_code", "Тип с таким кодом уже есть", { code: "Код занят" });
      }
      throw error;
    }
    const [row] = await sql<ListingTypeRow[]>`${listingTypeSelect()} WHERE t.id = ${id!}`;
    await writeAudit(ctx, request, "listing_type.created", { type: "listing_type", id: id! }, input);
    reply.code(201);
    return row!;
  });

  app.patch("/v1/admin/listing-types/:id", write, async (request): Promise<ListingTypeDto> => {
    const { id } = parseParams(numId, request, "Тип имущества");
    const input = definedOnly(parseBody(listingTypeUpdateSchema, request.body));
    if (Object.keys(input).length === 0) throw errors.validation({ _: "Нет изменений" });
    const has = (key: keyof typeof input) => input[key] !== undefined;
    const updated = await sql`
      UPDATE listing_types SET
        name       = CASE WHEN ${has("name")}::boolean THEN ${input.name ?? null} ELSE name END,
        operations = CASE WHEN ${has("operations")}::boolean THEN ${input.operations ?? null}::text[] ELSE operations END,
        max_images = CASE WHEN ${has("maxImages")}::boolean THEN ${input.maxImages ?? null}::smallint ELSE max_images END,
        is_active  = CASE WHEN ${has("isActive")}::boolean THEN ${input.isActive ?? null}::boolean ELSE is_active END,
        sort_order = CASE WHEN ${has("sortOrder")}::boolean THEN ${input.sortOrder ?? null}::int ELSE sort_order END,
        updated_at = now()
      WHERE id = ${id}::smallint`;
    if (updated.count === 0) throw errors.notFound("Тип имущества не найден");
    await writeAudit(ctx, request, "listing_type.updated", { type: "listing_type", id }, input);
    const [row] = await sql<ListingTypeRow[]>`${listingTypeSelect()} WHERE t.id = ${id}::smallint`;
    return row!;
  });

  // ── Категории ─────────────────────────────────────────────────────────────

  const categorySelect = () => sql`
    SELECT c.id, s.code AS section_code, c.parent_id, c.name, c.is_active, c.sort_order,
           (SELECT count(*)::int FROM catalog_items i WHERE i.category_id = c.id) AS items_count
    FROM categories c JOIN sections s ON s.id = c.section_id`;

  app.get("/v1/admin/categories", read, async (request): Promise<{ items: CategoryDto[] }> => {
    const { section } = z.object({ section: z.enum(["items", "cars", "notary"]).optional() }).parse(request.query);
    const rows = await sql<CategoryRow[]>`
      ${categorySelect()}
      ${section ? sql`WHERE s.code = ${section}` : sql``}
      ORDER BY s.sort_order, c.parent_id NULLS FIRST, c.sort_order, c.name`;
    return { items: [...rows] };
  });

  app.post("/v1/admin/categories", write, async (request, reply): Promise<CategoryDto> => {
    const input = parseBody(categoryCreateSchema, request.body);
    const section = await sectionId(input.sectionCode);
    if (input.parentId !== null) {
      const [parent] = await sql<{ sectionId: number; parentId: number | null }[]>`
        SELECT section_id, parent_id FROM categories WHERE id = ${input.parentId}`;
      if (!parent || parent.sectionId !== section) throw errors.validation({ parentId: "Родительская категория не найдена" });
      if (parent.parentId !== null) {
        throw errors.validation({ parentId: "Допускается только два уровня: категория и подкатегория" });
      }
    }
    let id: number | undefined;
    try {
      const [row] = await sql<{ id: number }[]>`
        INSERT INTO categories (section_id, parent_id, name, sort_order)
        VALUES (${section}, ${input.parentId}, ${input.name}, ${input.sortOrder}::int)
        RETURNING id`;
      id = row?.id;
    } catch (error) {
      if (uniqueViolation(error) !== null) {
        throw errors.conflict("duplicate_name", "Такая категория уже есть на этом уровне", { name: "Название занято" });
      }
      throw error;
    }
    await writeAudit(ctx, request, "category.created", { type: "category", id: id! }, input);
    const [row] = await sql<CategoryRow[]>`${categorySelect()} WHERE c.id = ${id!}`;
    reply.code(201);
    return row!;
  });

  app.patch("/v1/admin/categories/:id", write, async (request): Promise<CategoryDto> => {
    const { id } = parseParams(numId, request, "Категория");
    const patch = definedOnly(parseBody(categoryUpdateSchema, request.body));
    if (Object.keys(patch).length === 0) throw errors.validation({ _: "Нет изменений" });
    try {
      const updated = await sql`UPDATE categories SET ${sql(patch)}, updated_at = now() WHERE id = ${id}`;
      if (updated.count === 0) throw errors.notFound("Категория не найдена");
    } catch (error) {
      if (uniqueViolation(error) !== null) {
        throw errors.conflict("duplicate_name", "Такая категория уже есть на этом уровне", { name: "Название занято" });
      }
      throw error;
    }
    await writeAudit(ctx, request, "category.updated", { type: "category", id }, patch);
    const [row] = await sql<CategoryRow[]>`${categorySelect()} WHERE c.id = ${id}`;
    return row!;
  });

  // Удалить можно только пустую категорию; заполненную — скрыть (isActive = false).
  app.delete("/v1/admin/categories/:id", write, async (request, reply) => {
    const { id } = parseParams(numId, request, "Категория");
    const [usage] = await sql<{ children: number; items: number; name: string }[]>`
      SELECT c.name,
        (SELECT count(*)::int FROM categories ch WHERE ch.parent_id = c.id) AS children,
        (SELECT count(*)::int FROM catalog_items i WHERE i.category_id = c.id) AS items
      FROM categories c WHERE c.id = ${id}`;
    if (!usage) throw errors.notFound("Категория не найдена");
    if (usage.children > 0 || usage.items > 0) {
      throw errors.conflict(
        "category_not_empty",
        "В категории есть подкатегории или предметы. Удалите их или скройте категорию.",
      );
    }
    await sql`DELETE FROM categories WHERE id = ${id}`;
    await writeAudit(ctx, request, "category.deleted", { type: "category", id }, { name: usage.name });
    return reply.code(204).send();
  });

  // ── Справочник предметов и моделей ────────────────────────────────────────

  app.get("/v1/admin/catalog-items", read, async (request): Promise<{ items: CatalogItemDto[] }> => {
    const q = z
      .object({ categoryId: z.coerce.number().int().positive().optional(), query: z.string().trim().max(80).optional() })
      .parse(request.query);
    const conditions: Fragment[] = [];
    if (q.categoryId) conditions.push(sql`category_id = ${q.categoryId}`);
    if (q.query) {
      const like = `%${q.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(sql`(name ILIKE ${like} OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE a ILIKE ${like}))`);
    }
    const where = conditions.reduce((acc, cond, i) => (i === 0 ? sql`WHERE ${cond}` : sql`${acc} AND ${cond}`), sql``);
    const rows = await sql<CatalogItemRow[]>`
      SELECT ${sql.unsafe(ITEM_COLUMNS)} FROM catalog_items ${where} ORDER BY sort_order, name LIMIT 1000`;
    return { items: rows.map(toItemDto) };
  });

  app.post("/v1/admin/catalog-items", write, async (request, reply): Promise<CatalogItemDto> => {
    const input = parseBody(catalogItemCreateSchema, request.body);
    const [category] = await sql`SELECT 1 FROM categories WHERE id = ${input.categoryId}`;
    if (!category) throw errors.validation({ categoryId: "Категория не найдена" });
    try {
      const [row] = await sql<CatalogItemRow[]>`
        INSERT INTO catalog_items (category_id, name, aliases, sort_order)
        VALUES (${input.categoryId}, ${input.name}, ${input.aliases}::text[],
                (SELECT COALESCE(max(sort_order), 0) + 1 FROM catalog_items WHERE category_id = ${input.categoryId}))
        RETURNING ${sql.unsafe(ITEM_COLUMNS)}`;
      await writeAudit(ctx, request, "catalog_item.created", { type: "catalog_item", id: row!.id }, input);
      reply.code(201);
      return toItemDto(row!);
    } catch (error) {
      throw error;
    }
  });

  app.patch("/v1/admin/catalog-items/:id", write, async (request): Promise<CatalogItemDto> => {
    const { id } = parseParams(numId, request, "Предмет");
    const input = definedOnly(parseBody(catalogItemUpdateSchema, request.body));
    if (Object.keys(input).length === 0) throw errors.validation({ _: "Нет изменений" });
    if (input.categoryId) {
      const [category] = await sql`SELECT 1 FROM categories WHERE id = ${input.categoryId}`;
      if (!category) throw errors.validation({ categoryId: "Категория не найдена" });
    }
    const has = (key: keyof typeof input) => input[key] !== undefined;
    try {
      const [row] = await sql<CatalogItemRow[]>`
        UPDATE catalog_items SET
          name        = CASE WHEN ${has("name")}::boolean THEN ${input.name ?? null} ELSE name END,
          aliases     = CASE WHEN ${has("aliases")}::boolean THEN ${input.aliases ?? null}::text[] ELSE aliases END,
          is_active   = CASE WHEN ${has("isActive")}::boolean THEN ${input.isActive ?? null}::boolean ELSE is_active END,
          category_id = CASE WHEN ${has("categoryId")}::boolean THEN ${input.categoryId ?? null}::int ELSE category_id END,
          updated_at = now()
        WHERE id = ${id}
        RETURNING ${sql.unsafe(ITEM_COLUMNS)}`;
      if (!row) throw errors.notFound("Предмет не найден");
      await writeAudit(ctx, request, "catalog_item.updated", { type: "catalog_item", id }, input);
      return toItemDto(row);
    } catch (error) {
      throw error;
    }
  });

  // Пока объявлений нет, предмет можно удалить. На шаге 4 используемые предметы будут только скрываться.
  app.delete("/v1/admin/catalog-items/:id", write, async (request, reply) => {
    const { id } = parseParams(numId, request, "Предмет");
    const [used] = await sql`SELECT 1 FROM listings WHERE catalog_item_id = ${id} LIMIT 1`;
    if (used) {
      throw errors.conflict("item_in_use", "На этот предмет есть объявления — его можно только скрыть");
    }
    const [row] = await sql<{ name: string; iconPath: string | null }[]>`
      DELETE FROM catalog_items WHERE id = ${id} RETURNING name, icon_path`;
    if (!row) throw errors.notFound("Предмет не найден");
    await removeMediaDir(ctx.uploadDir, `icons/${id}`);
    await writeAudit(ctx, request, "catalog_item.deleted", { type: "catalog_item", id }, { name: row.name });
    return reply.code(204).send();
  });

  // Иконка предмета: PNG/JPG/WebP (станет WebP 256×256) или короткое видео WebM.
  app.post("/v1/admin/catalog-items/:id/icon", write, async (request) => {
    const { id } = parseParams(numId, request, "Предмет");
    const [item] = await sql<{ iconPath: string | null }[]>`SELECT icon_path FROM catalog_items WHERE id = ${id}`;
    if (!item) throw errors.notFound("Предмет не найден");
    const file = await request.file();
    if (!file) throw errors.validation({ icon: "Прикрепите файл" });
    const saved = await saveIcon(ctx.uploadDir, id, await file.toBuffer());
    const [row] = await sql<CatalogItemRow[]>`
      UPDATE catalog_items SET icon_path = ${saved.path}, icon_kind = ${saved.kind}, updated_at = now()
      WHERE id = ${id}
      RETURNING ${sql.unsafe(ITEM_COLUMNS)}`;
    await removeMedia(ctx.uploadDir, [item.iconPath]);
    await writeAudit(ctx, request, "catalog_item.icon_updated", { type: "catalog_item", id }, { kind: saved.kind });
    return toItemDto(row!);
  });

  app.delete("/v1/admin/catalog-items/:id/icon", write, async (request) => {
    const { id } = parseParams(numId, request, "Предмет");
    const [item] = await sql<{ iconPath: string | null }[]>`SELECT icon_path FROM catalog_items WHERE id = ${id}`;
    if (!item) throw errors.notFound("Предмет не найден");
    const [row] = await sql<CatalogItemRow[]>`
      UPDATE catalog_items SET icon_path = NULL, icon_kind = NULL, updated_at = now()
      WHERE id = ${id}
      RETURNING ${sql.unsafe(ITEM_COLUMNS)}`;
    await removeMedia(ctx.uploadDir, [item.iconPath]);
    return toItemDto(row!);
  });

  // ── Конструктор полей характеристик ───────────────────────────────────────

  const columns = () => attributeColumns(sql);

  /** Категории поля должны быть из раздела этого типа имущества. */
  const checkCategories = async (listingTypeId: number, ids: number[]) => {
    if (ids.length === 0) return;
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM categories c JOIN listing_types t ON t.section_id = c.section_id
      WHERE t.id = ${listingTypeId}::smallint AND c.id = ANY(${ids}::int[])`;
    if ((row?.count ?? 0) !== ids.length) {
      throw errors.validation({ categoryIds: "Категории должны быть из раздела этого типа имущества" });
    }
  };

  app.get("/v1/admin/attributes", read, async (request): Promise<{ items: AttributeDefinitionDto[] }> => {
    const { listingTypeId } = z.object({ listingTypeId: z.coerce.number().int().positive() }).parse(request.query);
    const rows = await sql<AttributeRow[]>`
      SELECT ${columns()} FROM attribute_definitions
      WHERE listing_type_id = ${listingTypeId}::smallint
      ORDER BY sort_order, id`;
    return { items: rows.map(toAttributeDto) };
  });

  app.post("/v1/admin/attributes", write, async (request, reply): Promise<AttributeDefinitionDto> => {
    const input = parseBody(attributeCreateSchema, request.body);
    const [type] = await sql`SELECT 1 FROM listing_types WHERE id = ${input.listingTypeId}::smallint`;
    if (!type) throw errors.validation({ listingTypeId: "Тип имущества не найден" });
    const options = input.dataType === "select" || input.dataType === "multiselect" ? input.options : [];
    const numeric = input.dataType === "number";
    await checkCategories(input.listingTypeId, input.categoryIds);
    try {
      const [row] = await sql<AttributeRow[]>`
        INSERT INTO attribute_definitions (
          listing_type_id, key, label, data_type, unit, options, min_value, max_value, step_value,
          category_ids, required, filterable, applies_to, help_text, is_active, sort_order
        ) VALUES (
          ${input.listingTypeId}::smallint, ${input.key}, ${input.label}, ${input.dataType},
          ${numeric ? input.unit : null}, ${options}::text[],
          ${numeric ? input.minValue : null}::numeric, ${numeric ? input.maxValue : null}::numeric,
          ${numeric ? input.stepValue : null}::numeric, ${input.categoryIds}::int[],
          ${input.required}, ${input.filterable}, ${input.appliesTo}, ${input.helpText},
          ${input.isActive}, ${input.sortOrder}::int
        )
        RETURNING ${columns()}`;
      await writeAudit(ctx, request, "attribute.created", { type: "attribute", id: row!.id }, input);
      reply.code(201);
      return toAttributeDto(row!);
    } catch (error) {
      if (uniqueViolation(error) !== null) {
        throw errors.conflict("duplicate_key", "У этого типа уже есть поле с таким ключом", { key: "Ключ занят" });
      }
      throw error;
    }
  });

  app.patch("/v1/admin/attributes/:id", write, async (request): Promise<AttributeDefinitionDto> => {
    const { id } = parseParams(numId, request, "Поле");
    const input = definedOnly(parseBody(attributeUpdateSchema, request.body));
    if (Object.keys(input).length === 0) throw errors.validation({ _: "Нет изменений" });

    const [current] = await sql<{ dataType: AttributeDefinitionDto["dataType"]; listingTypeId: number }[]>`
      SELECT data_type, listing_type_id FROM attribute_definitions WHERE id = ${id}`;
    if (!current) throw errors.notFound("Поле не найдено");
    if (input.categoryIds !== undefined) await checkCategories(current.listingTypeId, input.categoryIds);
    const isList = current.dataType === "select" || current.dataType === "multiselect";
    if (isList && input.options !== undefined && input.options.length === 0) {
      throw errors.validation({ options: "Добавьте хотя бы один вариант" });
    }

    // «Поле передано» и «поле пустое» — разные вещи: null очищает значение, отсутствие оставляет как есть.
    const has = (key: keyof typeof input) => input[key] !== undefined;
    const isNumber = current.dataType === "number";
    const [row] = await sql<AttributeRow[]>`
      UPDATE attribute_definitions SET
        label      = CASE WHEN ${has("label")}::boolean THEN ${input.label ?? null} ELSE label END,
        unit       = CASE WHEN ${has("unit") && isNumber}::boolean THEN ${input.unit ?? null} ELSE unit END,
        options    = CASE WHEN ${has("options") && isList}::boolean THEN ${input.options ?? null}::text[] ELSE options END,
        min_value  = CASE WHEN ${has("minValue") && isNumber}::boolean THEN ${input.minValue ?? null}::numeric ELSE min_value END,
        max_value  = CASE WHEN ${has("maxValue") && isNumber}::boolean THEN ${input.maxValue ?? null}::numeric ELSE max_value END,
        step_value = CASE WHEN ${has("stepValue") && isNumber}::boolean THEN ${input.stepValue ?? null}::numeric ELSE step_value END,
        category_ids = CASE WHEN ${has("categoryIds")}::boolean THEN ${input.categoryIds ?? []}::int[] ELSE category_ids END,
        required   = CASE WHEN ${has("required")}::boolean THEN ${input.required ?? null}::boolean ELSE required END,
        filterable = CASE WHEN ${has("filterable")}::boolean THEN ${input.filterable ?? null}::boolean ELSE filterable END,
        applies_to = CASE WHEN ${has("appliesTo")}::boolean THEN ${input.appliesTo ?? null} ELSE applies_to END,
        help_text  = CASE WHEN ${has("helpText")}::boolean THEN ${input.helpText ?? null} ELSE help_text END,
        is_active  = CASE WHEN ${has("isActive")}::boolean THEN ${input.isActive ?? null}::boolean ELSE is_active END,
        sort_order = CASE WHEN ${has("sortOrder")}::boolean THEN ${input.sortOrder ?? null}::int ELSE sort_order END,
        updated_at = now()
      WHERE id = ${id}
      RETURNING ${columns()}`;
    await writeAudit(ctx, request, "attribute.updated", { type: "attribute", id }, input);
    return toAttributeDto(row!);
  });

  app.delete("/v1/admin/attributes/:id", write, async (request, reply) => {
    const { id } = parseParams(numId, request, "Поле");
    const [row] = await sql<{ key: string }[]>`DELETE FROM attribute_definitions WHERE id = ${id} RETURNING key`;
    if (!row) throw errors.notFound("Поле не найдено");
    await writeAudit(ctx, request, "attribute.deleted", { type: "attribute", id }, { key: row.key });
    return reply.code(204).send();
  });
}
