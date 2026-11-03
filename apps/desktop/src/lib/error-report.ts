import { api, ApiError } from "./api";

/**
 * Отправка сбоев приложения на сервер, чтобы находить ошибки раньше,
 * чем о них напишут игроки. Без личных данных: текст ошибки, стек,
 * экран и версия. Одинаковые ошибки — не чаще раза в 10 минут.
 */

const sent = new Map<string, number>();
const REPEAT_MS = 10 * 60 * 1000;
const MAX_PER_SESSION = 30;
let total = 0;
let version = "";

export function setReportedVersion(v: string | null): void {
  version = v ?? "";
}

/** Шумные и не наши ошибки, которые не помогают. */
const IGNORE = [/ResizeObserver loop/i, /Script error\.?$/i, /Load failed/i, /Failed to fetch/i, /NetworkError/i, /AbortError/i];

export function reportError(error: unknown, extra: { componentStack?: string } = {}): void {
  // Ошибки ответов сервера сервер уже знает сам.
  if (error instanceof ApiError) return;
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Неизвестная ошибка");
  const message = `${err.name && err.name !== "Error" ? `${err.name}: ` : ""}${err.message}`.slice(0, 500);
  if (!err.message || IGNORE.some((re) => re.test(message))) return;
  const key = message;
  const now = Date.now();
  if ((sent.get(key) ?? 0) > now - REPEAT_MS || total >= MAX_PER_SESSION) return;
  sent.set(key, now);
  total += 1;
  const stack = `${err.stack ?? ""}${extra.componentStack ? `\nКомпоненты:${extra.componentStack}` : ""}`.slice(0, 4000);
  const route = window.location.hash.replace(/^#/, "").split("?")[0]?.slice(0, 200) ?? "";
  api.reportClientError({ message, stack, route, version }).catch(() => {
    // Не получилось отправить — ничего страшного.
  });
}

export function installErrorReporting(): void {
  window.addEventListener("error", (event) => reportError(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => reportError(event.reason));
}
