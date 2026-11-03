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
  sortOrder: number;
  icon: { url: string; kind: "image" | "video" } | null;
  /** ID в игре (одежда, анимации). */
  gameCode: string | null;
  /** Предпросмотр: картинка/гиф (WebP) или видео WebM. */
  preview: MediaDto | null;
  /** Звук к предпросмотру (у некоторых анимаций). */
  audioUrl: string | null;
  /** Содержимое кейса или набора — строки из админки. */
  contents: string[];
}

export interface AttributeDefinitionDto {
  id: number;
  listingTypeId: number;
  key: string;
  label: string;
  dataType: "number" | "text" | "select" | "multiselect" | "boolean" | "genes";
  unit: string | null;
  options: string[];
  minValue: number | null;
  maxValue: number | null;
  stepValue: number | null;
  /** Пусто — поле у всех объявлений типа; иначе только у предметов из этих категорий. */
  categoryIds: number[];
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

// ── Объявления ─────────────────────────────────────────────────────────────

export type SectionCode = "items" | "cars" | "notary";
export type ListingStatusDto = "draft" | "moderation" | "active" | "rejected" | "sold" | "withdrawn" | "archived";

export interface MediaDto {
  /** Путь на сервере API, например /media/listings/…/full.webp. */
  url: string;
  kind: "image" | "video";
}

export interface ListingImageDto {
  id: string;
  fullUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  isMain: boolean;
}

export interface ServerRefDto {
  number: number;
  name: string;
  color: string;
}

export interface ListingCardDto {
  id: string;
  sectionCode: SectionCode;
  listingType: { id: number; code: string; name: string };
  operation: "sell" | "buy" | "exchange";
  title: string;
  price: number | null;
  quantity: number;
  server: ServerRefDto;
  transferMode: "none" | "seller_moves" | "buyer_moves";
  sellerNickname: string;
  /** Главное фото или иконка предмета из справочника. */
  image: MediaDto | null;
  publishedAt: string | null;
  views: number;
  favorite: boolean;
  /** Цена ниже средней по этому предмету на сервере (если есть с чем сравнить). */
  belowAverage: boolean;
}

export interface ListingAttributeDto {
  key: string;
  label: string;
  value: string | number | boolean | string[];
  unit: string | null;
}

export interface PriceStatsDto {
  count: number;
  average: number;
  median: number;
  min: number;
  max: number;
}

export interface ListingDetailDto extends ListingCardDto {
  status: ListingStatusDto;
  description: string;
  category: { id: number; name: string } | null;
  catalogItem: CatalogItemInfoDto | null;
  images: ListingImageDto[];
  attributes: ListingAttributeDto[];
  dealPlaces: Array<"car_market" | "notary">;
  want: {
    listingType: { id: number; name: string } | null;
    attributes: ListingAttributeDto[];
    description: string;
    surcharge: number | null;
    surchargeDirection: "i_pay" | "they_pay" | null;
  } | null;
  seller: {
    login: string;
    memberSince: string;
    nickname: string;
    nicknameVerified: boolean;
    /** Сколько других аккаунтов указали такой же ник на этом сервере. */
    sameNicknameCount: number;
    activeListings: number;
    /** Отзывы по подтверждённым сделкам. */
    reviews: { positive: number; negative: number };
  };
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  isOwner: boolean;
  priceStats: PriceStatsDto | null;
  rejectionReason: string | null;
  /** Почему объявление на проверке (видит только автор). */
  moderationReason: string | null;
}

/** Объявление в «Моих объявлениях» и в форме редактирования. */
export interface MyListingDto extends ListingDetailDto {
  gameProfileId: string;
  categoryId: number | null;
  rawAttributes: Record<string, string | number | boolean | string[]>;
  rawWantAttributes: Record<string, string | number | boolean | string[]>;
  wantListingTypeId: number | null;
  favorites: number;
}

export interface ListingSearchResultDto {
  items: ListingCardDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CatalogItemOptionDto {
  id: number;
  categoryId: number;
  name: string;
  aliases: string[];
  icon: MediaDto | null;
  gameCode: string | null;
}

/** Позиция содержимого кейса; если нашлась в справочнике — с иконкой. */
export interface ContentEntryDto {
  name: string;
  note: string | null;
  item: { id: number; icon: MediaDto | null } | null;
}

/** Предмет справочника в карточке объявления, с предпросмотром. */
export interface CatalogItemInfoDto {
  id: number;
  name: string;
  icon: MediaDto | null;
  gameCode: string | null;
  preview: MediaDto | null;
  audioUrl: string | null;
  contents: ContentEntryDto[];
}
