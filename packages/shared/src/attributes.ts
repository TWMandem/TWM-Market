import { z } from "zod";
import type { AttributeSide, AttributeType } from "./admin.js";

/** Описание поля характеристики — то, что настраивается в конструкторе. */
export interface AttributeDefinition {
  key: string;
  label: string;
  dataType: AttributeType;
  unit: string | null;
  options: string[];
  minValue: number | null;
  maxValue: number | null;
  required: boolean;
  filterable: boolean;
  appliesTo: AttributeSide;
  helpText: string | null;
  isActive: boolean;
  sortOrder: number;
}

export type AttributeValue = string | number | boolean | string[];
export type AttributeValues = Record<string, AttributeValue>;

function fieldSchema(def: AttributeDefinition): z.ZodTypeAny {
  switch (def.dataType) {
    case "number": {
      let schema = z.number({ invalid_type_error: `${def.label}: введите число`, required_error: `Заполните «${def.label}»` });
      if (def.minValue !== null) schema = schema.min(def.minValue, `${def.label}: не меньше ${def.minValue}`);
      if (def.maxValue !== null) schema = schema.max(def.maxValue, `${def.label}: не больше ${def.maxValue}`);
      return schema;
    }
    case "text":
      return z
        .string({ required_error: `Заполните «${def.label}»` })
        .trim()
        .min(def.required ? 1 : 0, `Заполните «${def.label}»`)
        .max(200, `${def.label}: до 200 символов`);
    case "boolean":
      return z.boolean({ required_error: `Заполните «${def.label}»` });
    case "select":
      return z.enum(def.options as [string, ...string[]], {
        errorMap: () => ({ message: `${def.label}: выберите вариант из списка` }),
      });
    case "multiselect":
      return z
        .array(
          z.enum(def.options as [string, ...string[]], {
            errorMap: () => ({ message: `${def.label}: вариант не из списка` }),
          }),
        )
        .min(def.required ? 1 : 0, `Выберите хотя бы один вариант в «${def.label}»`)
        .transform((list) => Array.from(new Set(list)));
  }
}

/**
 * Строит проверку значений характеристик по описаниям полей.
 * Используется и в форме объявления, и на сервере: неизвестные поля
 * отбрасываются, обязательные проверяются, значения — по типу поля.
 */
export function buildAttributesSchema(
  definitions: readonly AttributeDefinition[],
  side: "offer" | "want" = "offer",
): z.ZodType<AttributeValues> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const def of definitions) {
    if (!def.isActive) continue;
    if (def.appliesTo !== "both" && def.appliesTo !== side) continue;
    const base = fieldSchema(def);
    shape[def.key] = def.required ? base : base.optional();
  }
  return z.object(shape).strip() as unknown as z.ZodType<AttributeValues>;
}
