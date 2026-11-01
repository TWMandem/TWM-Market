import { z } from "zod";
import type { ListingStatusDto, MediaDto, ServerRefDto } from "./api-types.js";

// ── Переписка ──────────────────────────────────────────────────────────────

export const MESSAGE_MAX = 2000;

export const messageSchema = z.object({
  body: z
    .string({ required_error: "Напишите сообщение" })
    .trim()
    .min(1, "Напишите сообщение")
    .max(MESSAGE_MAX, `Сообщение — до ${MESSAGE_MAX} символов`),
});

export type MessageKind = "text" | "image" | "deal_proposed" | "deal_confirmed" | "deal_cancelled";

export interface MessageDto {
  id: string;
  kind: MessageKind;
  body: string;
  image: { url: string; width: number; height: number } | null;
  /** null — служебное сообщение площадки. */
  mine: boolean | null;
  /** Скрыто модератором: текст не показывается. */
  hidden: boolean;
  createdAt: string;
}

export type DealStatus = "proposed" | "confirmed" | "cancelled";

export interface ReviewDto {
  id: string;
  positive: boolean;
  comment: string;
  author: { login: string };
  listingTitle: string;
  createdAt: string;
}

export interface DealDto {
  id: string;
  status: DealStatus;
  proposedByMe: boolean;
  proposedAt: string;
  confirmedAt: string | null;
  myReview: ReviewDto | null;
  theirReview: ReviewDto | null;
  /** Сделка подтверждена, а свой отзыв ещё не оставлен. */
  canReview: boolean;
}

export interface ConversationDto {
  id: string;
  /** Кто я в этой переписке. */
  role: "buyer" | "seller";
  listing: {
    id: string;
    title: string;
    price: number | null;
    operation: "sell" | "buy" | "exchange";
    status: ListingStatusDto;
    image: MediaDto | null;
    server: ServerRefDto;
  };
  counterpart: { login: string; nickname: string | null };
  lastMessage: { kind: MessageKind; body: string; mine: boolean | null; createdAt: string } | null;
  unread: number;
  deal: DealDto | null;
  lastMessageAt: string;
}

export interface MessagesPageDto {
  items: MessageDto[];
  /** Есть сообщения старше первого в списке. */
  hasMore: boolean;
}

// ── Отзывы ─────────────────────────────────────────────────────────────────

export const reviewSchema = z.object({
  positive: z.boolean({ required_error: "Выберите оценку" }),
  comment: z.string().trim().max(500, "Отзыв — до 500 символов").default(""),
});

export interface PublicUserDto {
  login: string;
  memberSince: string;
  reviews: { positive: number; negative: number };
  deals: number;
  activeListings: number;
  recentReviews: ReviewDto[];
}

// ── Уведомления ────────────────────────────────────────────────────────────

export type NotificationKind =
  | "message"
  | "deal_proposed"
  | "deal_confirmed"
  | "deal_cancelled"
  | "review"
  | "listing_moderation"
  | "listing_approved"
  | "listing_rejected"
  | "report_resolved";

export interface NotificationDto {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Путь в приложении, например /chats/…; null — некуда вести. */
  link: string | null;
  createdAt: string;
  read: boolean;
}

/** Ответ на периодический опрос: счётчики и новые уведомления. */
export interface UpdatesDto {
  unreadMessages: number;
  unreadNotifications: number;
  /** Уведомления новее переданного курсора (при первом опросе — пусто). */
  notifications: NotificationDto[];
  cursor: number;
}

// ── Жалобы ─────────────────────────────────────────────────────────────────

export const REPORT_TARGETS = ["listing", "message", "user", "review"] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_REASONS = ["real_money", "scam", "wrong_info", "duplicate", "insult", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason | "stop_word", string> = {
  real_money: "Продажа за реальные деньги",
  scam: "Мошенничество, обман при сделке",
  wrong_info: "Неверные сведения о товаре",
  duplicate: "Повтор объявления, спам объявлениями",
  insult: "Оскорбления",
  spam: "Реклама, спам",
  other: "Другое",
  stop_word: "Стоп-слово (проверка площадки)",
};

export const reportSchema = z
  .object({
    targetType: z.enum(REPORT_TARGETS),
    targetId: z.string().trim().min(1).max(60),
    reason: z.enum(REPORT_REASONS, { required_error: "Выберите причину" }),
    comment: z.string().trim().max(1000, "До 1000 символов").default(""),
  })
  .superRefine((data, ctx) => {
    if (data.reason === "other" && data.comment.length < 5) {
      ctx.addIssue({ code: "custom", path: ["comment"], message: "Опишите, что не так" });
    }
  });

// ── Модерация ──────────────────────────────────────────────────────────────

/** Сколько разных игроков должны пожаловаться, чтобы объявление скрылось до проверки. */
export const REPORTS_TO_HIDE = 3;

export const rejectListingSchema = z.object({
  reason: z.string().trim().min(3, "Укажите причину").max(300, "До 300 символов"),
});

export const resolveReportSchema = z.object({
  status: z.enum(["resolved", "dismissed"]),
  resolution: z.string().trim().max(500, "До 500 символов").default(""),
});

export const stopWordSchema = z
  .object({
    phrase: z.string().trim().min(2, "От 2 символов").max(60, "До 60 символов"),
    isRegex: z.boolean().default(false),
    note: z.string().trim().max(200).nullable().default(null),
  })
  .superRefine((data, ctx) => {
    if (!data.isRegex) return;
    try {
      new RegExp(data.phrase, "iu");
    } catch {
      ctx.addIssue({ code: "custom", path: ["phrase"], message: "Ошибка в регулярном выражении" });
    }
  });

export interface StopWordDto {
  id: number;
  phrase: string;
  isRegex: boolean;
  note: string | null;
  createdAt: string;
}

/**
 * Поиск стоп-слова в тексте. Фразы ищутся без учёта регистра и «ё»,
 * регулярные выражения — как есть (без учёта регистра).
 */
export function findStopWord<W extends { phrase: string; isRegex: boolean }>(text: string, words: readonly W[]): W | null {
  const normalized = text.toLowerCase().replace(/ё/g, "е");
  for (const word of words) {
    if (word.isRegex) {
      try {
        if (new RegExp(word.phrase, "iu").test(text)) return word;
      } catch {
        // Неверное выражение просто пропускаем.
      }
    } else if (normalized.includes(word.phrase.toLowerCase().replace(/ё/g, "е"))) {
      return word;
    }
  }
  return null;
}

export interface ModerationSummaryDto {
  listings: number;
  reports: number;
  messages: number;
}

export interface ReportDto {
  id: string;
  author: { login: string } | null;
  targetType: ReportTarget;
  targetId: string;
  reason: ReportReason | "stop_word";
  comment: string;
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
  resolvedBy: { login: string } | null;
  resolvedAt: string | null;
  resolution: string | null;
  /** Краткое описание объекта жалобы для очереди. */
  target: { title: string; text: string; listingId: string | null; conversationId: string | null; userLogin: string | null };
  /** Сколько всего открытых жалоб на этот объект. */
  openCount: number;
}

export interface ModerationListingDto {
  id: string;
  title: string;
  description: string;
  price: number | null;
  operation: "sell" | "buy" | "exchange";
  sectionCode: "items" | "cars" | "notary";
  server: ServerRefDto;
  author: { login: string; nickname: string };
  moderationReason: string | null;
  image: MediaDto | null;
  updatedAt: string;
}

export interface FlaggedMessageDto {
  id: string;
  conversationId: string;
  body: string;
  flagReason: string | null;
  sender: { login: string } | null;
  listingTitle: string;
  createdAt: string;
}

export interface ModeratorConversationDto {
  id: string;
  listing: { id: string; title: string };
  buyer: { login: string };
  seller: { login: string };
  messages: Array<MessageDto & { senderLogin: string | null; flagged: boolean }>;
}
