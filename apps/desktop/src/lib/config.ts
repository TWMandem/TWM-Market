const DEV_API_URL = "http://localhost:3000";

/**
 * Сервер площадки, к которому подключается собранное приложение (.exe).
 * Сборку можно направить на другой сервер переменной VITE_API_URL
 * (в GitHub — переменная репозитория API_URL).
 */
export const PRODUCTION_API_URL = "https://api.twm-market.ru";

/**
 * Приводит адрес API к единому виду: только http(s), без завершающего «/».
 * Если адрес неверный, возвращает адрес по умолчанию.
 */
export function normalizeApiUrl(raw: string | undefined, fallback = DEV_API_URL): string {
  if (!raw) return fallback;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

// В разработке (vite dev) — локальный сервер, в собранном приложении — сервер площадки.
const isProductionBuild = Boolean(import.meta.env?.PROD);
export const API_URL = normalizeApiUrl(
  import.meta.env?.VITE_API_URL as string | undefined,
  isProductionBuild ? PRODUCTION_API_URL : DEV_API_URL,
);
