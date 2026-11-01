/**
 * Системные коды объявлений. В отличие от категорий и характеристик,
 * они зашиты в код: от них зависит логика сервера (модерация, архивация,
 * отзывы). Подписи для интерфейса лежат рядом.
 */

export const LISTING_STATUSES = [
  "draft",
  "moderation",
  "active",
  "rejected",
  "sold",
  "withdrawn",
  "archived",
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  draft: "Черновик",
  moderation: "На модерации",
  active: "Активно",
  rejected: "Отклонено",
  sold: "Продано",
  withdrawn: "Снято с продажи",
  archived: "Архив",
};

export const OPERATIONS = ["sell", "buy", "exchange"] as const;
export type Operation = (typeof OPERATIONS)[number];

export const OPERATION_LABELS: Record<Operation, string> = {
  sell: "Продажа",
  buy: "Скупка",
  exchange: "Обмен",
};

/** Можно ли перенести сделку на другой сервер. */
export const TRANSFER_MODES = ["none", "seller_moves", "buyer_moves"] as const;
export type TransferMode = (typeof TRANSFER_MODES)[number];

export const TRANSFER_MODE_LABELS: Record<TransferMode, string> = {
  none: "Невозможен, только мой сервер",
  seller_moves: "Продавец готов перевестись",
  buyer_moves: "Перевестись должен покупатель",
};
