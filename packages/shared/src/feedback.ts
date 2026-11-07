import { z } from "zod";

export const FEEDBACK_CATEGORIES = ["improvement", "problem", "other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  improvement: "Идея или улучшение",
  problem: "Что-то неудобно или не работает",
  other: "Другое",
};

export const FEEDBACK_STATUSES = ["new", "reviewing", "planned", "done", "declined"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "Новое",
  reviewing: "Рассматривается",
  planned: "Запланировано",
  done: "Готово",
  declined: "Не планируется",
};

export const feedbackCreateSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES).default("improvement"),
  title: z.string({ required_error: "Напишите короткий заголовок" }).trim().min(5, "От 5 символов").max(120, "До 120 символов"),
  description: z
    .string({ required_error: "Опишите предложение" })
    .trim()
    .min(20, "Опишите подробнее — хотя бы 20 символов")
    .max(4000, "До 4000 символов"),
});

export const feedbackUpdateSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES),
  response: z.string().trim().max(2000, "Ответ — до 2000 символов").default(""),
});

export interface FeedbackDto {
  id: string;
  category: FeedbackCategory;
  title: string;
  description: string;
  status: FeedbackStatus;
  response: string;
  author: { id: string; login: string } | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
}

