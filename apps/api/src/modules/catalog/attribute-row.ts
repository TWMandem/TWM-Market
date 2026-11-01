import type { AttributeDefinitionDto } from "@twm/shared";
import type { Sql } from "../../db/client.js";

/** Строка attribute_definitions: numeric приходит из базы строкой. */
export interface AttributeRow extends Omit<AttributeDefinitionDto, "minValue" | "maxValue" | "stepValue"> {
  minValue: string | null;
  maxValue: string | null;
  stepValue: string | null;
}

/** Колонки описания поля — одинаковые для приложения, админки и проверки объявлений. */
export const attributeColumns = (sql: Sql) => sql`
  id, listing_type_id, key, label, data_type, unit, options, min_value, max_value, step_value,
  category_ids, required, filterable, applies_to, help_text, is_active, sort_order`;

const num = (value: string | null) => (value === null ? null : Number(value));

export const toAttributeDto = (row: AttributeRow): AttributeDefinitionDto => ({
  ...row,
  minValue: num(row.minValue),
  maxValue: num(row.maxValue),
  stepValue: num(row.stepValue),
  categoryIds: row.categoryIds ?? [],
});
