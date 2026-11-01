/**
 * Форма ответов API. Сервер и приложение используют одни и те же типы,
 * поэтому расхождение ловится проверкой типов ещё до запуска.
 */

export type Role = "user" | "moderator" | "admin" | "superadmin";

export interface ApiErrorBody {
  /** Машинный код ошибки, например invalid_credentials. */
  error: string;
  /** Сообщение для человека, на русском. */
  message: string;
  /** Ошибки по полям формы. */
  fields?: Record<string, string>;
}

export interface MeDto {
  id: string;
  login: string;
  email: string;
  emailVerified: boolean;
  role: Role;
  createdAt: string;
}

export interface AuthResponseDto {
  accessToken: string;
  /** Через сколько секунд истечёт токен доступа. */
  expiresIn: number;
  refreshToken: string;
  user: MeDto;
}

export interface ServerDto {
  number: number;
  name: string;
  color: string;
  isActive: boolean;
  transferOpen: boolean;
}

export interface GameProfileDto {
  id: string;
  nickname: string;
  server: { number: number; name: string; color: string };
  verified: boolean;
  /** Сколько других аккаунтов указали такой же ник на этом сервере. */
  sameNicknameCount: number;
  /** С какого момента можно снова сменить ник (ISO), или null. */
  nicknameChangeAvailableAt: string | null;
  createdAt: string;
}

export interface SessionDto {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
}
