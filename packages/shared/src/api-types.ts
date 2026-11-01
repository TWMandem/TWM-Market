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

// ── Админ-панель ───────────────────────────────────────────────────────────

export interface TwoFactorStatusDto {
  enabled: boolean;
  /** Ввёл ли пользователь код в этой сессии. */
  sessionVerified: boolean;
}

export interface TwoFactorSetupDto {
  /** Секрет в base32 — для ручного ввода в приложение-аутентификатор. */
  secret: string;
  /** Ссылка otpauth:// для QR-кода. */
  otpauthUrl: string;
}

export interface AdminStatsDto {
  users: { total: number; new7d: number; new30d: number; verified: number; blocked: number; staff: number };
  gameProfiles: number;
  activeSessions: number;
  /** Регистрации по дням за последние 30 дней (включая сегодня). */
  registrationsByDay: Array<{ date: string; count: number }>;
}

export interface AdminUserListItemDto {
  id: string;
  login: string;
  email: string;
  role: Role;
  status: "active" | "blocked";
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  gameProfiles: number;
}

export interface AdminUserDetailDto extends AdminUserListItemDto {
  blockedReason: string | null;
  blockedAt: string | null;
  activeSessions: number;
  profiles: Array<{
    id: string;
    nickname: string;
    server: { number: number; name: string; color: string };
    createdAt: string;
    history: Array<{ oldNickname: string; newNickname: string; changedAt: string }>;
  }>;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SectionDto {
  id: number;
  code: "items" | "cars" | "notary";
  name: string;
  description: string;
  isActive: boolean;
  sortOrder: number;
}

export interface ListingTypeDto {
  id: number;
  sectionCode: "items" | "cars" | "notary";
  code: string;
  name: string;
  operations: Array<"sell" | "buy" | "exchange">;
  maxImages: number;
  isActive: boolean;
  sortOrder: number;
}

export interface CategoryDto {
  id: number;
  sectionCode: "items" | "cars" | "notary";
  parentId: number | null;
  name: string;
  isActive: boolean;
  sortOrder: number;
  itemsCount: number;
}

export interface CatalogItemDto {
  id: number;
  categoryId: number;
  name: string;
  aliases: string[];
  isActive: boolean;
}

export interface AttributeDefinitionDto {
  id: number;
  listingTypeId: number;
  key: string;
  label: string;
  dataType: "number" | "text" | "select" | "multiselect" | "boolean";
  unit: string | null;
  options: string[];
  minValue: number | null;
  maxValue: number | null;
  required: boolean;
  filterable: boolean;
  appliesTo: "offer" | "want" | "both";
  helpText: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface AuditEntryDto {
  id: number;
  actor: { id: string; login: string } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}
