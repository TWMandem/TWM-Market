import type {
  ApiErrorBody,
  AuthResponseDto,
  GameProfileDto,
  MeDto,
  ServerDto,
  SessionDto,
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
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
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
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Нужен ли вход. По умолчанию — да, если токен есть. */
  auth?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const send = () => {
    const headers: Record<string, string> = {};
    if (options.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return rawFetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
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
};
