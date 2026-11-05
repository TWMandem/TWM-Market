/**
 * Праздничное оформление приложения и сайта. Включает администратор
 * (админ-панель → «Оформление»), игрок может скрыть его у себя.
 */
export const SEASONS = ["halloween"] as const;
export type Season = (typeof SEASONS)[number];

export const SEASON_LABELS: Record<Season, string> = {
  halloween: "Хеллоуин",
};

/** Что показывать сейчас (GET /v1/appearance, без входа). */
export interface AppearanceDto {
  season: Season | null;
}

/** Настройка в админ-панели. */
export interface AdminAppearanceDto {
  season: Season | null;
  /** Когда оформление выключится само (ISO) или null — пока не выключат. */
  until: string | null;
  updatedAt: string;
  updatedBy: string | null;
}
