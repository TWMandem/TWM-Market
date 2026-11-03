import { z } from "zod";
import type { SectionCode, ServerRefDto } from "./api-types.js";

// ── Общие типы статистики ──────────────────────────────────────────────────

/** Значение за день (дата по Москве, YYYY-MM-DD). */
export interface DayValue {
  date: string;
  value: number;
}

// ── Дашборд администратора ─────────────────────────────────────────────────

export const STATS_PERIODS = [7, 30, 90] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

export interface StatsMetricDto {
  /** Сумма за выбранный период. */
  total: number;
  /** То же за предыдущий период такой же длины — для сравнения. */
  previous: number;
  byDay: DayValue[];
}

export type AdminMetricKey = "registrations" | "published" | "views" | "activeUsers" | "deals" | "messages";

export const ADMIN_METRIC_LABELS: Record<AdminMetricKey, string> = {
  registrations: "Регистрации",
  published: "Новые объявления",
  views: "Просмотры объявлений",
  activeUsers: "Активные пользователи",
  deals: "Подтверждённые сделки",
  messages: "Сообщения в чатах",
};

export interface AdminStatsDto {
  days: StatsPeriod;
  users: { total: number; verified: number; blocked: number; staff: number };
  gameProfiles: number;
  activeSessions: number;
  listings: {
    active: number;
    moderation: number;
    bySection: Array<{ code: SectionCode; name: string; active: number }>;
  };
  /** Для «активных пользователей» total — разные игроки за период, а не сумма по дням. */
  metrics: Record<AdminMetricKey, StatsMetricDto>;
  /** Категории по числу новых объявлений за период. */
  topCategories: Array<{ id: number; name: string; sectionCode: SectionCode; listings: number; views: number }>;
  /** Предметы и модели по просмотрам объявлений за период. */
  topItems: Array<{ id: number; name: string; sectionCode: SectionCode; listings: number; views: number }>;
}

// ── Статистика объявления для продавца ─────────────────────────────────────

export const LISTING_STATS_DAYS = 30;

export interface ListingStatsDto {
  views: number;
  viewsToday: number;
  /** Просмотры по дням за последние 30 дней. */
  viewsByDay: DayValue[];
  favorites: number;
  conversations: number;
  deals: number;
  /**
   * Место цены среди активных предложений о продаже этого предмета
   * на том же сервере (1 — самое дешёвое). null — сравнивать не с чем.
   */
  position: { rank: number; total: number; median: number; min: number } | null;
}

// ── История цены предмета или модели ───────────────────────────────────────

export const PRICE_HISTORY_DAYS = [30, 90, 365] as const;
export type PriceHistoryDays = (typeof PRICE_HISTORY_DAYS)[number];

export interface PricePointDto {
  date: string;
  /** Сколько было предложений о продаже. */
  offers: number;
  /** Медиана есть только по одному серверу. */
  median: number | null;
  average: number;
  min: number;
  max: number;
}

export interface PriceHistoryDto {
  item: { id: number; name: string };
  /** null — по всем серверам. */
  server: ServerRefDto | null;
  days: PriceHistoryDays;
  /** Предложения о продаже прямо сейчас. */
  current: { count: number; average: number; median: number; min: number; max: number } | null;
  history: PricePointDto[];
  /** Подтверждённые сделки по объявлениям с этим предметом за период. */
  deals: {
    count: number;
    average: number | null;
    recent: Array<{ price: number; date: string; server: ServerRefDto; operation: "sell" | "buy" }>;
  };
}

// ── Подписки на поиск ──────────────────────────────────────────────────────

export const SAVED_SEARCH_LIMIT = 20;

export type SavedSearchSection = SectionCode | "search";

/** Параметры, которые не влияют на то, какие объявления подходят. */
const IGNORED_SEARCH_PARAMS = new Set(["page", "sort"]);

/**
 * Приводит параметры фильтра к одному виду: без страницы и сортировки,
 * без пустых значений, ключи по алфавиту. Так одинаковые поиски
 * сохраняются одной подпиской.
 */
export function normalizeSearchParams(params: string): string {
  // Без URLSearchParams: общий пакет собирается и для сервера, и для приложения.
  const decode = (text: string) => {
    try {
      return decodeURIComponent(text.replace(/\+/g, " "));
    } catch {
      return text;
    }
  };
  const entries: Array<[string, string]> = [];
  for (const pair of params.replace(/^\?/, "").split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = decode(eq === -1 ? pair : pair.slice(0, eq));
    const value = decode(eq === -1 ? "" : pair.slice(eq + 1)).trim();
    if (key && value && !IGNORED_SEARCH_PARAMS.has(key)) entries.push([key, value]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

export const savedSearchSchema = z.object({
  name: z.string({ required_error: "Назовите подписку" }).trim().min(1, "Назовите подписку").max(60, "До 60 символов"),
  section: z.enum(["items", "cars", "notary", "search"]),
  params: z.string().max(1000, "Слишком много условий").transform(normalizeSearchParams),
  notify: z.boolean().default(true),
});

export const savedSearchUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Назовите подписку").max(60, "До 60 символов").optional(),
    notify: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.notify !== undefined, { message: "Нечего менять" });

export interface SavedSearchDto {
  id: string;
  name: string;
  section: SavedSearchSection;
  /** Параметры запроса к /v1/listings (раздел, тип, сервер, фильтры). */
  params: string;
  notify: boolean;
  createdAt: string;
  /** Подходящих объявлений, опубликованных после последнего просмотра (не больше 100). */
  newCount: number;
}
