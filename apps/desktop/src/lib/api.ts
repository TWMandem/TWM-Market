import type {
  AdminStatsDto,
  AdminUserDetailDto,
  AdminUserListItemDto,
  ApiErrorBody,
  AttributeDefinitionDto,
  AuditEntryDto,
  AuthResponseDto,
  CatalogItemDto,
  CatalogItemOptionDto,
  CategoryDto,
  ConversationDto,
  FlaggedMessageDto,
  MessageDto,
  MessagesPageDto,
  ModerationListingDto,
  ModerationSummaryDto,
  ModeratorConversationDto,
  NotificationDto,
  ListingStatsDto,
  PriceHistoryDto,
  PublicUserDto,
  SavedSearchDto,
  SavedSearchSection,
  BlockedUserDto,
  NicknameVerificationDto,
  AdminListingDto,
  AdminUserActivityDto,
  AppErrorGroupDto,
  VerificationQueueItemDto,
  StatsPeriod,
  ReportDto,
  ReportReason,
  ReportTarget,
  StopWordDto,
  UpdatesDto,
  GameProfileDto,
  ListingCardDto,
  ListingDetailDto,
  ListingImageDto,
  ListingSearchResultDto,
  ListingTypeDto,
  MeDto,
  MyListingDto,
  Paged,
  SectionCode,
  SectionDto,
  ServerDto,
  SessionDto,
  TwoFactorSetupDto,
  TwoFactorStatusDto,
} from "@twm/shared";
import { API_URL } from "./config";
import { tokenStore } from "./token-store";

export type GameServer = ServerDto;

export interface HealthResponse {
  status: "ok";
  version: string;
  time: string;
}

/** Ошибка от сервера с кодом, сообщением и ошибками по полям формы. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const NETWORK_ERROR = "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.";

// ── Токены ────────────────────────────────────────────────────────────────
// Токен доступа живёт только в памяти. Refresh-токен — в хранилище Windows.

let accessToken: string | null = null;
let refreshing: Promise<AuthResponseDto | null> | null = null;
let onSessionEnded: (() => void) | null = null;

/** Вызывается, когда сервер закрыл сессию (выход на другом устройстве, блокировка). */
export function setSessionEndedHandler(handler: (() => void) | null): void {
  onSessionEnded = handler;
}

export async function applyAuth(auth: AuthResponseDto): Promise<void> {
  accessToken = auth.accessToken;
  await tokenStore.set(auth.refreshToken);
}

export async function clearAuth(): Promise<void> {
  accessToken = null;
  await tokenStore.clear();
}

/**
 * Обновляет пару токенов. Одновременные вызовы ждут один и тот же запрос:
 * иначе второй запрос предъявил бы уже заменённый токен и сессия закрылась бы.
 */
export function refreshSession(): Promise<AuthResponseDto | null> {
  refreshing ??= (async () => {
    try {
      const token = await tokenStore.get();
      if (!token) return null;
      const response = await rawFetch("/v1/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: token }),
      });
      if (response.status === 401 || response.status === 403) {
        await clearAuth();
        return null;
      }
      if (!response.ok) throw await toApiError(response);
      const auth = (await response.json()) as AuthResponseDto;
      await applyAuth(auth);
      return auth;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// ── Запросы ───────────────────────────────────────────────────────────────

async function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  // Загрузка файлов может идти дольше обычного запроса.
  const timeout = window.setTimeout(() => controller.abort(), init.body instanceof FormData ? 120_000 : 10_000);
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  // Для FormData заголовок с границей частей браузер выставит сам.
  if (init.body !== undefined && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  try {
    return await fetch(`${API_URL}${path}`, { ...init, headers, signal: controller.signal });
  } catch {
    throw new ApiError(0, "network_error", NETWORK_ERROR);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    return new ApiError(
      response.status,
      body.error ?? "error",
      body.message ?? `Ошибка сервера (${response.status})`,
      body.fields ?? {},
    );
  } catch {
    return new ApiError(response.status, "error", `Ошибка сервера (${response.status})`);
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Нужен ли вход. По умолчанию — да, если токен есть. */
  auth?: boolean;
  /** Ответ — файл (картинка), а не JSON. */
  blob?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const send = () => {
    const headers: Record<string, string> = {};
    if (options.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const isForm = options.body instanceof FormData;
    return rawFetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : isForm ? (options.body as FormData) : JSON.stringify(options.body),
    });
  };

  let response = await send();

  // Токен доступа истёк — обновляем и повторяем запрос один раз.
  if (response.status === 401 && options.auth !== false) {
    const renewed = await refreshSession();
    if (renewed) {
      response = await send();
    } else {
      onSessionEnded?.();
    }
  }

  if (!response.ok) {
    const error = await toApiError(response);
    if (error.code === "account_blocked") onSessionEnded?.();
    throw error;
  }
  if (response.status === 204) return undefined as T;
  if (options.blob) return (await response.blob()) as T;
  return (await response.json()) as T;
}

// ── Методы API ────────────────────────────────────────────────────────────

export const api = {
  health: () => request<HealthResponse>("/health", { auth: false }),
  servers: () => request<{ items: ServerDto[] }>("/v1/servers", { auth: false }),

  register: (body: { login: string; email: string; password: string; rulesAccepted: boolean }) =>
    request<AuthResponseDto>("/v1/auth/register", { method: "POST", body, auth: false }),
  login: (body: { identifier: string; password: string }) =>
    request<AuthResponseDto>("/v1/auth/login", { method: "POST", body, auth: false }),
  logout: () => request<void>("/v1/auth/logout", { method: "POST" }),
  verifyEmail: (code: string) => request<MeDto>("/v1/auth/verify-email", { method: "POST", body: { code } }),
  resendVerification: () => request<void>("/v1/auth/verify-email/resend", { method: "POST" }),
  forgotPassword: (email: string) =>
    request<{ message: string }>("/v1/auth/password/forgot", { method: "POST", body: { email }, auth: false }),
  resetPassword: (body: { email: string; code: string; password: string }) =>
    request<AuthResponseDto>("/v1/auth/password/reset", { method: "POST", body, auth: false }),

  me: () => request<MeDto>("/v1/me"),
  sessions: () => request<{ items: SessionDto[] }>("/v1/me/sessions"),
  revokeSession: (id: string) => request<void>(`/v1/me/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  revokeOtherSessions: () => request<void>("/v1/me/sessions/revoke-others", { method: "POST" }),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<void>("/v1/me/password", { method: "POST", body }),

  gameProfiles: () => request<{ items: GameProfileDto[] }>("/v1/me/game-profiles"),
  createGameProfile: (body: { nickname: string; serverNumber: number }) =>
    request<GameProfileDto>("/v1/me/game-profiles", { method: "POST", body }),
  renameGameProfile: (id: string, nickname: string) =>
    request<GameProfileDto>(`/v1/me/game-profiles/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { nickname },
    }),
  deleteGameProfile: (id: string) =>
    request<void>(`/v1/me/game-profiles/${encodeURIComponent(id)}`, { method: "DELETE" }),

  twoFactorStatus: () => request<TwoFactorStatusDto>("/v1/me/2fa"),
  twoFactorSetup: () => request<TwoFactorSetupDto>("/v1/me/2fa/setup", { method: "POST" }),
  twoFactorEnable: (code: string) => request<TwoFactorStatusDto>("/v1/me/2fa/enable", { method: "POST", body: { code } }),
  twoFactorVerify: (code: string) => request<TwoFactorStatusDto>("/v1/me/2fa/verify", { method: "POST", body: { code } }),

  catalogItems: (params: { categoryId?: number; section?: SectionCode; q?: string }) =>
    request<{ items: CatalogItemOptionDto[] }>(`/v1/catalog/items${qs(params)}`, { auth: false }),
  attributes: (listingTypeId: number) =>
    request<{ items: AttributeDefinitionDto[] }>(`/v1/catalog/attributes${qs({ listingTypeId })}`, { auth: false }),

  searchListings: (params: Record<string, string | number | undefined>) =>
    request<ListingSearchResultDto>(`/v1/listings${qs(params)}`),
  listing: (id: string) => request<ListingDetailDto>(`/v1/listings/${encodeURIComponent(id)}`),
  myListings: (status?: string) =>
    request<{
      items: Array<
        ListingCardDto & {
          status: MyListingDto["status"];
          expiresAt: string | null;
          rejectionReason: string | null;
          moderationReason: string | null;
          favorites: number;
          bumpAvailableAt: string | null;
        }
      >;
      counts: Record<string, number>;
    }>(`/v1/me/listings${qs({ status })}`),
  myListing: (id: string) => request<MyListingDto>(`/v1/me/listings/${encodeURIComponent(id)}`),
  createListing: (body: unknown) => request<MyListingDto>("/v1/listings", { method: "POST", body }),
  updateListing: (id: string, body: unknown) => request<MyListingDto>(`/v1/listings/${encodeURIComponent(id)}`, { method: "PUT", body }),
  listingAction: (id: string, action: "publish" | "extend" | "withdraw" | "sold" | "bump") =>
    request<MyListingDto>(`/v1/listings/${encodeURIComponent(id)}/${action}`, { method: "POST" }),
  deleteListing: (id: string) => request<void>(`/v1/listings/${encodeURIComponent(id)}`, { method: "DELETE" }),
  uploadListingImage: (id: string, file: Blob, name = "image.png") => {
    const form = new FormData();
    form.append("file", file, name);
    return request<{ images: ListingImageDto[] }>(`/v1/listings/${encodeURIComponent(id)}/images`, { method: "POST", body: form });
  },
  orderListingImages: (id: string, order: string[], mainId: string | null) =>
    request<{ images: ListingImageDto[] }>(`/v1/listings/${encodeURIComponent(id)}/images`, { method: "PUT", body: { order, mainId } }),
  deleteListingImage: (id: string, imageId: string) =>
    request<{ images: ListingImageDto[] }>(`/v1/listings/${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}`, { method: "DELETE" }),
  favorite: (id: string, on: boolean) =>
    request<void>(`/v1/listings/${encodeURIComponent(id)}/favorite`, { method: on ? "POST" : "DELETE" }),
  favorites: () => request<{ items: Array<ListingCardDto & { status: string }> }>("/v1/me/favorites"),

  catalog: () =>
    request<{ sections: SectionDto[]; listingTypes: ListingTypeDto[]; categories: CategoryDto[] }>("/v1/catalog", {
      auth: false,
    }),

  // ── Переписка, сделки, отзывы ───────────────────────────────────────────
  startConversation: (listingId: string) =>
    request<ConversationDto>(`/v1/listings/${encodeURIComponent(listingId)}/conversations`, { method: "POST" }),
  conversations: () => request<{ items: ConversationDto[] }>("/v1/me/conversations"),
  conversation: (id: string) => request<ConversationDto>(`/v1/conversations/${encodeURIComponent(id)}`),
  messages: (id: string, params: { before?: string; after?: string } = {}) =>
    request<MessagesPageDto>(`/v1/conversations/${encodeURIComponent(id)}/messages${qs(params)}`),
  sendMessage: (id: string, body: string) =>
    request<MessageDto>(`/v1/conversations/${encodeURIComponent(id)}/messages`, { method: "POST", body: { body } }),
  sendImage: (id: string, file: Blob, name = "screenshot.png") => {
    const form = new FormData();
    form.append("file", file, name);
    return request<MessageDto>(`/v1/conversations/${encodeURIComponent(id)}/images`, { method: "POST", body: form });
  },
  markConversationRead: (id: string) => request<void>(`/v1/conversations/${encodeURIComponent(id)}/read`, { method: "POST" }),
  dealAction: (id: string, action: "propose" | "confirm" | "cancel") =>
    request<ConversationDto>(
      `/v1/conversations/${encodeURIComponent(id)}/deal${action === "propose" ? "" : `/${action}`}`,
      { method: "POST" },
    ),
  review: (id: string, body: { positive: boolean; comment: string }) =>
    request<ConversationDto>(`/v1/conversations/${encodeURIComponent(id)}/review`, { method: "POST", body }),
  publicUser: (login: string) => request<PublicUserDto>(`/v1/users/${encodeURIComponent(login)}`),

  // ── Уведомления и жалобы ────────────────────────────────────────────────
  updates: (after?: number) => request<UpdatesDto>(`/v1/me/updates${qs({ after })}`),
  notifications: () => request<{ items: NotificationDto[] }>("/v1/me/notifications"),
  readNotifications: (ids?: number[]) =>
    request<void>("/v1/me/notifications/read", { method: "POST", body: ids ? { ids } : {} }),
  report: (body: { targetType: ReportTarget; targetId: string; reason: ReportReason; comment: string }) =>
    request<{ id: string }>("/v1/reports", { method: "POST", body }),

  // ── Статистика и цены ───────────────────────────────────────────────────
  listingStats: (id: string) => request<ListingStatsDto>(`/v1/me/listings/${encodeURIComponent(id)}/stats`),
  similarListings: (id: string) => request<{ items: ListingCardDto[] }>(`/v1/listings/${encodeURIComponent(id)}/similar`),
  priceHistory: (itemId: number, params: { server?: number; days?: number }) =>
    request<PriceHistoryDto>(`/v1/catalog/items/${itemId}/prices${qs(params)}`, { auth: false }),

  // ── Подписки на поиск ───────────────────────────────────────────────────
  savedSearches: () => request<{ items: SavedSearchDto[] }>("/v1/me/saved-searches"),
  createSavedSearch: (body: { name: string; section: SavedSearchSection; params: string; notify: boolean }) =>
    request<SavedSearchDto>("/v1/me/saved-searches", { method: "POST", body }),
  updateSavedSearch: (id: string, body: { name?: string; notify?: boolean }) =>
    request<SavedSearchDto>(`/v1/me/saved-searches/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  seenSavedSearch: (id: string) => request<SavedSearchDto>(`/v1/me/saved-searches/${encodeURIComponent(id)}/seen`, { method: "POST" }),
  deleteSavedSearch: (id: string) => request<void>(`/v1/me/saved-searches/${encodeURIComponent(id)}`, { method: "DELETE" }),

  reportClientError: (body: { message: string; stack: string; route: string; version: string }) =>
    request<void>("/v1/client-errors", { method: "POST", body }),

  // ── Подтверждение ника ─────────────────────────────────────────────────
  nicknameVerification: (profileId: string) =>
    request<NicknameVerificationDto>(`/v1/me/game-profiles/${encodeURIComponent(profileId)}/verification`),
  sendNicknameScreenshot: (profileId: string, file: Blob, name = "stats.png") => {
    const form = new FormData();
    form.append("file", file, name);
    return request<NicknameVerificationDto>(`/v1/me/game-profiles/${encodeURIComponent(profileId)}/verification`, { method: "POST", body: form });
  },

  // ── Настройки, шаблоны ответов, чёрный список ───────────────────────────
  updateSettings: (body: { showOnline: boolean }) => request<MeDto>("/v1/me/settings", { method: "PATCH", body }),
  chatTemplates: () => request<{ items: string[] }>("/v1/me/chat-templates"),
  saveChatTemplates: (items: string[]) => request<{ items: string[] }>("/v1/me/chat-templates", { method: "PUT", body: { items } }),
  blocks: () => request<{ items: BlockedUserDto[] }>("/v1/me/blocks"),
  blockUser: (login: string, on: boolean) =>
    request<void>(`/v1/users/${encodeURIComponent(login)}/block`, { method: on ? "POST" : "DELETE" }),
};

/** Полный адрес файла с сервера (фото, иконки). */
export function mediaSrc(path: string): string {
  return path.startsWith("http") || path.startsWith("blob:") ? path : `${API_URL}${path}`;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

/** Методы админ-панели. Сервер проверяет роль и двухфакторный вход на каждом запросе. */
export const adminApi = {
  stats: (days: StatsPeriod) => request<AdminStatsDto>(`/v1/admin/stats${qs({ days })}`),

  users: (params: { query?: string; role?: string; status?: string; page?: number }) =>
    request<Paged<AdminUserListItemDto>>(`/v1/admin/users${qs(params)}`),
  user: (id: string) => request<AdminUserDetailDto>(`/v1/admin/users/${encodeURIComponent(id)}`),
  blockUser: (id: string, reason: string) =>
    request<AdminUserDetailDto>(`/v1/admin/users/${encodeURIComponent(id)}/block`, { method: "POST", body: { reason } }),
  unblockUser: (id: string) =>
    request<AdminUserDetailDto>(`/v1/admin/users/${encodeURIComponent(id)}/unblock`, { method: "POST" }),
  changeRole: (id: string, role: string) =>
    request<AdminUserDetailDto>(`/v1/admin/users/${encodeURIComponent(id)}/role`, { method: "POST", body: { role } }),

  servers: () => request<{ items: ServerDto[] }>("/v1/admin/servers"),
  createServer: (body: unknown) => request<ServerDto>("/v1/admin/servers", { method: "POST", body }),
  updateServer: (number: number, body: unknown) =>
    request<ServerDto>(`/v1/admin/servers/${number}`, { method: "PATCH", body }),

  sections: () => request<{ items: SectionDto[] }>("/v1/admin/sections"),
  updateSection: (code: string, body: unknown) =>
    request<SectionDto>(`/v1/admin/sections/${code}`, { method: "PATCH", body }),

  listingTypes: () => request<{ items: ListingTypeDto[] }>("/v1/admin/listing-types"),
  createListingType: (body: unknown) => request<ListingTypeDto>("/v1/admin/listing-types", { method: "POST", body }),
  updateListingType: (id: number, body: unknown) =>
    request<ListingTypeDto>(`/v1/admin/listing-types/${id}`, { method: "PATCH", body }),

  categories: (section?: string) => request<{ items: CategoryDto[] }>(`/v1/admin/categories${qs({ section })}`),
  createCategory: (body: unknown) => request<CategoryDto>("/v1/admin/categories", { method: "POST", body }),
  updateCategory: (id: number, body: unknown) =>
    request<CategoryDto>(`/v1/admin/categories/${id}`, { method: "PATCH", body }),
  deleteCategory: (id: number) => request<void>(`/v1/admin/categories/${id}`, { method: "DELETE" }),

  catalogItems: (params: { categoryId?: number; query?: string }) =>
    request<{ items: CatalogItemDto[] }>(`/v1/admin/catalog-items${qs(params)}`),
  createCatalogItem: (body: unknown) => request<CatalogItemDto>("/v1/admin/catalog-items", { method: "POST", body }),
  updateCatalogItem: (id: number, body: unknown) =>
    request<CatalogItemDto>(`/v1/admin/catalog-items/${id}`, { method: "PATCH", body }),
  deleteCatalogItem: (id: number) => request<void>(`/v1/admin/catalog-items/${id}`, { method: "DELETE" }),
  uploadCatalogIcon: (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file, file.name);
    return request<CatalogItemDto>(`/v1/admin/catalog-items/${id}/icon`, { method: "POST", body: form });
  },
  deleteCatalogIcon: (id: number) => request<CatalogItemDto>(`/v1/admin/catalog-items/${id}/icon`, { method: "DELETE" }),
  /** Предпросмотр (WebM, GIF, картинка) или звук (MP3, OGG, WAV) к предмету справочника. */
  uploadCatalogMedia: (id: number, media: "preview" | "audio", file: File) => {
    const form = new FormData();
    form.append("file", file, file.name);
    return request<CatalogItemDto>(`/v1/admin/catalog-items/${id}/${media}`, { method: "POST", body: form });
  },
  deleteCatalogMedia: (id: number, media: "preview" | "audio") =>
    request<CatalogItemDto>(`/v1/admin/catalog-items/${id}/${media}`, { method: "DELETE" }),

  attributes: (listingTypeId: number) =>
    request<{ items: AttributeDefinitionDto[] }>(`/v1/admin/attributes${qs({ listingTypeId })}`),
  createAttribute: (body: unknown) => request<AttributeDefinitionDto>("/v1/admin/attributes", { method: "POST", body }),
  updateAttribute: (id: number, body: unknown) =>
    request<AttributeDefinitionDto>(`/v1/admin/attributes/${id}`, { method: "PATCH", body }),
  deleteAttribute: (id: number) => request<void>(`/v1/admin/attributes/${id}`, { method: "DELETE" }),

  audit: (params: { page?: number; action?: string }) => request<Paged<AuditEntryDto>>(`/v1/admin/audit${qs(params)}`),

  // ── Модерация ───────────────────────────────────────────────────────────
  moderationSummary: () => request<ModerationSummaryDto>("/v1/admin/moderation/summary"),
  moderationListings: () => request<{ items: ModerationListingDto[] }>("/v1/admin/moderation/listings"),
  approveListing: (id: string) =>
    request<{ ok: true }>(`/v1/admin/moderation/listings/${encodeURIComponent(id)}/approve`, { method: "POST" }),
  rejectListing: (id: string, reason: string) =>
    request<{ ok: true }>(`/v1/admin/moderation/listings/${encodeURIComponent(id)}/reject`, { method: "POST", body: { reason } }),
  reports: (status: "open" | "resolved" | "dismissed" = "open") => request<{ items: ReportDto[] }>(`/v1/admin/reports${qs({ status })}`),
  resolveReport: (id: string, status: "resolved" | "dismissed", resolution: string) =>
    request<{ ok: true }>(`/v1/admin/reports/${encodeURIComponent(id)}/resolve`, { method: "POST", body: { status, resolution } }),
  flaggedMessages: () => request<{ items: FlaggedMessageDto[] }>("/v1/admin/messages/flagged"),
  hideMessage: (id: string) => request<{ ok: true }>(`/v1/admin/messages/${encodeURIComponent(id)}/hide`, { method: "POST" }),
  clearMessage: (id: string) => request<{ ok: true }>(`/v1/admin/messages/${encodeURIComponent(id)}/clear`, { method: "POST" }),
  hideReview: (id: string) => request<{ ok: true }>(`/v1/admin/reviews/${encodeURIComponent(id)}/hide`, { method: "POST" }),
  conversation: (id: string) => request<ModeratorConversationDto>(`/v1/admin/conversations/${encodeURIComponent(id)}`),
  listings: (params: { q?: string; status?: string; login?: string; server?: number; reported?: string; page?: number }) =>
    request<Paged<AdminListingDto>>(`/v1/admin/listings${qs(params)}`),
  bulkListings: (body: { ids: string[]; action: "approve" | "reject"; reason?: string }) =>
    request<{ done: number; skipped: number }>("/v1/admin/listings/bulk", { method: "POST", body }),
  errors: (params: { days?: number; source?: string }) => request<{ items: AppErrorGroupDto[] }>(`/v1/admin/errors${qs(params)}`),
  userActivity: (id: string) => request<AdminUserActivityDto>(`/v1/admin/users/${encodeURIComponent(id)}/activity`),
  verifications: () => request<{ items: VerificationQueueItemDto[] }>("/v1/admin/verifications"),
  verificationImage: (id: string) => request<Blob>(`/v1/admin/verifications/${encodeURIComponent(id)}/image`, { blob: true }),
  approveVerification: (id: string) => request<{ ok: true }>(`/v1/admin/verifications/${encodeURIComponent(id)}/approve`, { method: "POST" }),
  rejectVerification: (id: string, reason: string) =>
    request<{ ok: true }>(`/v1/admin/verifications/${encodeURIComponent(id)}/reject`, { method: "POST", body: { reason } }),
  stopWords: () => request<{ items: StopWordDto[] }>("/v1/admin/stop-words"),
  createStopWord: (body: { phrase: string; isRegex: boolean; note: string | null }) =>
    request<StopWordDto>("/v1/admin/stop-words", { method: "POST", body }),
  deleteStopWord: (id: number) => request<void>(`/v1/admin/stop-words/${id}`, { method: "DELETE" }),
};
