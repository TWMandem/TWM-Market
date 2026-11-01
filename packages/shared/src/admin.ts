import { z } from "zod";
import { OPERATIONS } from "./listings.js";

/**
 * Схемы данных админ-панели: справочники, пользователи, двухфакторный вход.
 * Одни и те же правила работают в форме приложения и на сервере.
 */

const name = (max: number, label = "Название") =>
  z
    .string({ required_error: `Введите ${label.toLowerCase()}` })
    .trim()
    .min(1, `Введите ${label.toLowerCase()}`)
    .max(max, `${label} — до ${max} символов`);

export const codeKeySchema = z
  .string({ required_error: "Введите код" })
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, "Латиница в нижнем регистре, цифры и «_», начинается с буквы, 2–40 символов");

export const hexColorSchema = z
  .string({ required_error: "Укажите цвет" })
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Цвет в формате #RRGGBB");

// ── Двухфакторный вход ─────────────────────────────────────────────────────

export const totpCodeSchema = z
  .string({ required_error: "Введите код" })
  .trim()
  .regex(/^\d{6}$/, "Код — 6 цифр из приложения-аутентификатора");

export const totpVerifySchema = z.object({ code: totpCodeSchema });

// ── Серверы ────────────────────────────────────────────────────────────────

export const serverCreateSchema = z.object({
  number: z.number({ required_error: "Укажите номер" }).int().min(1).max(999),
  name: name(32).regex(/^[A-Za-z0-9 _-]+$/, "Латиница, цифры, пробел, «_» и «-»"),
  color: hexColorSchema,
  isActive: z.boolean().default(true),
  transferOpen: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export const serverUpdateSchema = serverCreateSchema.omit({ number: true }).partial();

// ── Разделы и типы имущества ───────────────────────────────────────────────

export const sectionUpdateSchema = z
  .object({
    name: name(60),
    description: z.string().trim().max(300, "Описание — до 300 символов"),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial();

const operationsSchema = z
  .array(z.enum(OPERATIONS))
  .min(1, "Выберите хотя бы одну операцию")
  .transform((ops) => Array.from(new Set(ops)));

export const listingTypeCreateSchema = z.object({
  sectionCode: z.enum(["items", "cars", "notary"], { required_error: "Выберите раздел" }),
  code: codeKeySchema,
  name: name(60),
  operations: operationsSchema,
  maxImages: z.number().int().min(0).max(20).default(10),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export const listingTypeUpdateSchema = z
  .object({
    name: name(60),
    operations: operationsSchema,
    maxImages: z.number().int().min(0).max(20),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial();

// ── Категории и справочник предметов ───────────────────────────────────────

export const categoryCreateSchema = z.object({
  sectionCode: z.enum(["items", "cars", "notary"], { required_error: "Выберите раздел" }),
  parentId: z.number().int().positive().nullable().default(null),
  name: name(60),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export const categoryUpdateSchema = z
  .object({
    name: name(60),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial();

const aliasesSchema = z
  .array(z.string().trim().min(1).max(80))
  .max(20, "Не больше 20 синонимов")
  .transform((list) => Array.from(new Set(list.map((a) => a.trim()).filter(Boolean))));

export const catalogItemCreateSchema = z.object({
  categoryId: z.number({ required_error: "Выберите категорию" }).int().positive(),
  name: name(80),
  aliases: aliasesSchema.default([]),
});
export const catalogItemUpdateSchema = z
  .object({
    name: name(80),
    aliases: aliasesSchema,
    isActive: z.boolean(),
    categoryId: z.number().int().positive(),
  })
  .partial();

// ── Конструктор полей характеристик ────────────────────────────────────────

export const ATTRIBUTE_TYPES = ["number", "text", "select", "multiselect", "boolean"] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

export const ATTRIBUTE_TYPE_LABELS: Record<AttributeType, string> = {
  number: "Число",
  text: "Текст",
  select: "Выбор одного варианта",
  multiselect: "Выбор нескольких вариантов",
  boolean: "Да / нет",
};

export const ATTRIBUTE_SIDES = ["offer", "want", "both"] as const;
export type AttributeSide = (typeof ATTRIBUTE_SIDES)[number];

export const ATTRIBUTE_SIDE_LABELS: Record<AttributeSide, string> = {
  offer: "Что продают или отдают",
  want: "Что хотят получить (обмен)",
  both: "В обоих случаях",
};

const attributeBase = z.object({
  key: codeKeySchema,
  label: name(60, "Подпись"),
  dataType: z.enum(ATTRIBUTE_TYPES, { required_error: "Выберите тип поля" }),
  unit: z.string().trim().max(16, "Единица — до 16 символов").nullable().default(null),
  options: z
    .array(z.string().trim().min(1).max(60, "Вариант — до 60 символов"))
    .max(100, "Не больше 100 вариантов")
    .default([]),
  minValue: z.number().nullable().default(null),
  maxValue: z.number().nullable().default(null),
  required: z.boolean().default(false),
  filterable: z.boolean().default(false),
  appliesTo: z.enum(ATTRIBUTE_SIDES).default("offer"),
  helpText: z.string().trim().max(200, "Подсказка — до 200 символов").nullable().default(null),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

function checkAttribute(
  value: { dataType?: AttributeType; options?: string[]; minValue?: number | null; maxValue?: number | null },
  ctx: z.RefinementCtx,
) {
  if ((value.dataType === "select" || value.dataType === "multiselect") && (value.options?.length ?? 0) === 0) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "Добавьте хотя бы один вариант" });
  }
  if (value.options && new Set(value.options.map((o) => o.toLowerCase())).size !== value.options.length) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "Варианты повторяются" });
  }
  if (value.minValue != null && value.maxValue != null && value.minValue > value.maxValue) {
    ctx.addIssue({ code: "custom", path: ["maxValue"], message: "Максимум меньше минимума" });
  }
}

export const attributeCreateSchema = attributeBase
  .extend({ listingTypeId: z.number({ required_error: "Выберите тип имущества" }).int().positive() })
  .superRefine(checkAttribute);

/** Ключ и тип поля после создания не меняются: на них будут опираться сохранённые объявления. */
export const attributeUpdateSchema = attributeBase
  .omit({ key: true, dataType: true })
  .partial()
  .superRefine(checkAttribute);

// ── Пользователи ───────────────────────────────────────────────────────────

export const blockUserSchema = z.object({
  reason: z.string({ required_error: "Укажите причину" }).trim().min(3, "Укажите причину").max(300),
});

export const changeRoleSchema = z.object({
  role: z.enum(["user", "moderator", "admin"], { required_error: "Выберите роль" }),
});
