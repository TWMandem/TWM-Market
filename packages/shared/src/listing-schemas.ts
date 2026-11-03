import { z } from "zod";
import { MAX_PRICE } from "./price.js";
import { OPERATIONS, TRANSFER_MODES } from "./listings.js";

/** Срок публикации объявления, дней. После него объявление уходит в архив. */
export const LISTING_TTL_DAYS = 14;
/** Поднять объявление наверх «Новых» можно раз в столько часов. */
export const BUMP_INTERVAL_HOURS = 24;
/** Сколько активных объявлений может быть у одного аккаунта одновременно. */
export const MAX_ACTIVE_LISTINGS = 50;
export const LISTING_TITLE_MAX = 80;
export const LISTING_DESCRIPTION_MAX = 2000;

export const DEAL_PLACES = ["car_market", "notary"] as const;
export type DealPlace = (typeof DEAL_PLACES)[number];
export const DEAL_PLACE_LABELS: Record<DealPlace, string> = {
  car_market: "Авторынок «Анашан»",
  notary: "Нотариальная контора",
};

export const SURCHARGE_DIRECTIONS = ["i_pay", "they_pay"] as const;
export type SurchargeDirection = (typeof SURCHARGE_DIRECTIONS)[number];
export const SURCHARGE_DIRECTION_LABELS: Record<SurchargeDirection, string> = {
  i_pay: "Доплачу я",
  they_pay: "Доплата мне",
};

const priceSchema = z
  .number({ invalid_type_error: "Введите цену" })
  .int("Цена — целое число")
  .min(1, "Цена должна быть больше нуля")
  .max(MAX_PRICE, "Слишком большая цена");

const attributeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

/**
 * Данные объявления от продавца. Характеристики здесь проверяются только
 * по форме; по описаниям полей типа их проверяет сервер (и форма в приложении).
 */
export const listingInputSchema = z
  .object({
    gameProfileId: z.string({ required_error: "Выберите игровой профиль" }).uuid("Выберите игровой профиль"),
    listingTypeId: z.number({ required_error: "Выберите тип имущества" }).int().positive(),
    operation: z.enum(OPERATIONS, { required_error: "Выберите тип операции" }),
    catalogItemId: z.number().int().positive().nullable().default(null),
    title: z
      .string()
      .trim()
      .max(LISTING_TITLE_MAX, `Название — до ${LISTING_TITLE_MAX} символов`)
      .default(""),
    description: z
      .string()
      .trim()
      .max(LISTING_DESCRIPTION_MAX, `Описание — до ${LISTING_DESCRIPTION_MAX} символов`)
      .default(""),
    price: priceSchema.nullable().default(null),
    quantity: z.number().int().min(1, "Минимум 1").max(100_000).default(1),
    transferMode: z.enum(TRANSFER_MODES).default("none"),
    dealPlaces: z
      .array(z.enum(DEAL_PLACES))
      .default([])
      .transform((list) => Array.from(new Set(list))),
    attributes: z.record(attributeValueSchema).default({}),
    wantListingTypeId: z.number().int().positive().nullable().default(null),
    wantAttributes: z.record(attributeValueSchema).default({}),
    wantDescription: z.string().trim().max(1000, "До 1000 символов").default(""),
    surcharge: priceSchema.nullable().default(null),
    surchargeDirection: z.enum(SURCHARGE_DIRECTIONS).nullable().default(null),
  })
  .superRefine((data, ctx) => {
    if (data.operation !== "exchange" && data.price === null) {
      ctx.addIssue({ code: "custom", path: ["price"], message: "Укажите цену" });
    }
    if (data.operation === "exchange") {
      if (!data.wantDescription && Object.keys(data.wantAttributes).length === 0 && data.wantListingTypeId === null) {
        ctx.addIssue({ code: "custom", path: ["wantDescription"], message: "Опишите, что хотите получить взамен" });
      }
      if ((data.surcharge === null) !== (data.surchargeDirection === null)) {
        ctx.addIssue({ code: "custom", path: ["surcharge"], message: "Укажите сумму и кто доплачивает" });
      }
    }
  });
export type ListingInput = z.infer<typeof listingInputSchema>;

export const imageOrderSchema = z.object({
  /** id фотографий в нужном порядке. */
  order: z.array(z.string().uuid()).max(20),
  mainId: z.string().uuid().nullable().default(null),
});

export const LISTING_SORTS = ["new", "price_asc", "price_desc", "popular"] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];
export const LISTING_SORT_LABELS: Record<ListingSort, string> = {
  new: "Сначала новые",
  price_asc: "Дешевле",
  price_desc: "Дороже",
  popular: "Популярные",
};

export const LISTING_PERIODS = ["1d", "7d", "30d"] as const;
export type ListingPeriod = (typeof LISTING_PERIODS)[number];
