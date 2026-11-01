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
  /** Шаг для чисел: например 5 — значения 5, 10, 15… (от минимума или от нуля). */
  stepValue: number | null;
  /**
   * Категории справочника, к предметам которых относится поле.
   * Пустой список — поле есть у всех объявлений этого типа.
   */
  categoryIds: number[];
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
      const step = def.stepValue;
      if (step !== null && step > 0) {
        const base = def.minValue ?? 0;
        return schema.refine((value) => isStepMultiple(value - base, step), {
          message: `${def.label}: значение кратно ${step}${def.minValue !== null && def.minValue % step !== 0 ? ` от ${def.minValue}` : ""}`,
        });
      }
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

function isStepMultiple(offset: number, step: number): boolean {
  const ratio = offset / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

/**
 * Поля, которые относятся к объявлению с предметом из этих категорий.
 * categoryPath — категория предмета и её родитель; null — предмет не выбран
 * (тогда остаются только поля без привязки к категориям).
 */
export function definitionsForCategory<T extends Pick<AttributeDefinition, "categoryIds">>(
  definitions: readonly T[],
  categoryPath: readonly number[] | null,
): T[] {
  return definitions.filter(
    (def) => def.categoryIds.length === 0 || (categoryPath !== null && categoryPath.some((id) => def.categoryIds.includes(id))),
  );
}

/**
 * Единица измерения поля: обычная («%», «л») пишется после значения,
 * шаблон с {} подставляет значение внутрь («X{}» → «X15»).
 */
export function unitParts(unit: string | null): { prefix: string; suffix: string } {
  if (!unit) return { prefix: "", suffix: "" };
  const at = unit.indexOf("{}");
  if (at === -1) return { prefix: "", suffix: unit };
  return { prefix: unit.slice(0, at), suffix: unit.slice(at + 2) };
}

/** Значение характеристики для показа: «Да», «85 %», «X15», «STAGE 2». */
export function formatAttributeValue(value: AttributeValue, unit: string | null): string {
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (Array.isArray(value)) return value.join(", ");
  const text = typeof value === "number" ? value.toLocaleString("ru-RU") : value;
  if (!unit) return text;
  if (unit.includes("{}")) return unit.replace("{}", text);
  return `${text} ${unit}`;
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
