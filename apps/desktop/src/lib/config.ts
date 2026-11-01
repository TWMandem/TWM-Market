const DEFAULT_API_URL = "http://localhost:3000";

/**
 * Приводит адрес API к единому виду: только http(s), без завершающего «/».
 * Если адрес неверный, возвращает адрес по умолчанию.
 */
export function normalizeApiUrl(raw: string | undefined): string {
  if (!raw) return DEFAULT_API_URL;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return DEFAULT_API_URL;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_API_URL;
  }
}

export const API_URL = normalizeApiUrl(import.meta.env?.VITE_API_URL as string | undefined);
