import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  OPERATION_LABELS,
  formatPrice,
  formatPriceShort,
  type ListingCardDto,
  type MediaDto,
  type Operation,
} from "@twm/shared";
import { mediaSrc } from "../lib/api";
import { Icon } from "./Icon";

/** Цвета типов операций: продажа — янтарный, скупка — голубой, обмен — фиолетовый. */
export const OPERATION_STYLES: Record<Operation, string> = {
  sell: "bg-accent/20 text-accent-soft",
  buy: "bg-buy/20 text-buy",
  exchange: "bg-exchange/20 text-exchange",
};

export function OperationBadge({ operation, className = "" }: { operation: Operation; className?: string }) {
  return (
    <span className={`rounded-lg px-2.5 py-1 text-xs font-extrabold ${OPERATION_STYLES[operation]} ${className}`}>
      {OPERATION_LABELS[operation]}
    </span>
  );
}

export function ServerDot({ color, size = 8 }: { color: string; size?: number }) {
  return <span aria-hidden="true" className="inline-block shrink-0 rounded-full" style={{ background: color, width: size, height: size }} />;
}

/** Картинка или короткое видео (иконки WebM проигрываются без звука по кругу). */
export function Media({
  media,
  alt,
  className = "",
  fit = "cover",
}: {
  media: MediaDto | null;
  alt: string;
  className?: string;
  fit?: "cover" | "contain";
}) {
  if (!media) {
    return (
      <div className={`placeholder-stripes flex items-center justify-center text-[13px] text-faint ${className}`}>
        <Icon name="box" size={28} />
      </div>
    );
  }
  const objectFit = fit === "cover" ? "object-cover" : "object-contain";
  if (media.kind === "video") {
    return (
      <video
        src={mediaSrc(media.url)}
        className={`${objectFit} ${className}`}
        autoPlay
        muted
        loop
        playsInline
        aria-label={alt}
      />
    );
  }
  return <img src={mediaSrc(media.url)} alt={alt} loading="lazy" className={`${objectFit} ${className}`} />;
}

export function priceText(price: number | null, operation: Operation): string {
  if (price === null) return operation === "exchange" ? "Обмен" : "Цена не указана";
  return operation === "buy" ? `до ${formatPrice(price)}` : formatPrice(price);
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} дн`;
  return new Date(iso).toLocaleDateString("ru-RU");
}

/** Карточка объявления в каталоге. */
export function ListingCard({
  listing,
  onToggleFavorite,
  priceNote,
}: {
  listing: ListingCardDto;
  onToggleFavorite?: ((listing: ListingCardDto) => void) | undefined;
  /** Строка под ценой — например, «было …» в избранном. */
  priceNote?: ReactNode;
}) {
  const isItem = listing.sectionCode === "items";
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-[18px] border border-line bg-surface transition-colors hover:border-faint">
      <Link to={`/listing/${listing.id}`} className="flex flex-1 flex-col text-ink no-underline">
        <div className="relative h-[150px] bg-surface-2">
          <Media media={listing.image} alt={listing.title} fit={isItem && listing.image?.kind !== "image" ? "contain" : "cover"} className="size-full" />
          <OperationBadge operation={listing.operation} className="absolute left-3 top-3" />
          {listing.belowAverage && (
            <span className="absolute bottom-3 left-3 rounded-lg bg-success/20 px-2.5 py-1 text-xs font-bold text-success backdrop-blur">
              Ниже средней
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 px-4 pb-4 pt-3.5">
          <h3 className="m-0 line-clamp-2 text-base font-bold leading-snug">{listing.title}</h3>
          {isItem && listing.quantity > 1 && <span className="text-[13px] text-muted">{listing.quantity} шт.</span>}
          <span className="mt-1 font-mono text-[19px] font-bold text-accent-soft tabular" title={listing.price ? formatPrice(listing.price) : undefined}>
            {listing.price !== null && listing.price >= 10_000_000 ? formatPriceShort(listing.price) : priceText(listing.price, listing.operation)}
          </span>
          {priceNote}
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-line-soft pt-2.5 text-[13px] text-muted">
            <span className="flex min-w-0 items-center gap-1.5">
              <ServerDot color={listing.server.color} />
              <span className="truncate">{listing.sellerNickname}</span>
              {listing.sellerVerified && (
                <span title="Ник подтверждён модератором" aria-label="ник подтверждён" className="shrink-0 font-bold text-success">
                  ✔
                </span>
              )}
            </span>
            <span className="shrink-0">{timeAgo(listing.publishedAt)}</span>
          </div>
        </div>
      </Link>
      {onToggleFavorite && (
        <button
          type="button"
          aria-label={listing.favorite ? "Убрать из избранного" : "В избранное"}
          aria-pressed={listing.favorite}
          onClick={() => onToggleFavorite(listing)}
          className={`absolute right-1.5 top-1.5 flex size-11 items-center justify-center rounded-xl ${
            listing.favorite ? "text-accent-ink" : "text-ink"
          } hover:bg-black/30`}
        >
          <Icon name="heart" size={20} fill={listing.favorite ? "currentColor" : "none"} />
        </button>
      )}
    </article>
  );
}

export function ListingGrid<T extends ListingCardDto>({
  items,
  onToggleFavorite,
  priceNote,
}: {
  items: T[];
  onToggleFavorite?: ((listing: ListingCardDto) => void) | undefined;
  priceNote?: ((listing: T) => ReactNode) | undefined;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
      {items.map((item) => (
        <ListingCard key={item.id} listing={item} onToggleFavorite={onToggleFavorite} priceNote={priceNote?.(item)} />
      ))}
    </div>
  );
}

/** Список: одна строка на объявление — удобно сравнивать цены. */
export function ListingList({
  items,
  onToggleFavorite,
}: {
  items: ListingCardDto[];
  onToggleFavorite?: ((listing: ListingCardDto) => void) | undefined;
}) {
  return (
    <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[18px] border border-line bg-surface p-0">
      {items.map((l) => {
        const isItem = l.sectionCode === "items";
        return (
          <li key={l.id} className="group relative border-b border-line-soft last:border-b-0">
            <Link
              to={`/listing/${l.id}`}
              className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2.5 pl-2.5 pr-14 text-ink no-underline transition-colors hover:bg-surface-2/60 md:grid-cols-[64px_minmax(0,1fr)_170px_90px]"
            >
              <Media
                media={l.image}
                alt=""
                fit={isItem && l.image?.kind !== "image" ? "contain" : "cover"}
                className="h-12 w-16 rounded-lg bg-surface-2"
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[15px] font-bold">{l.title}</span>
                  {isItem && l.quantity > 1 && <span className="shrink-0 text-[13px] text-muted">{l.quantity} шт.</span>}
                  {l.belowAverage && (
                    <span className="shrink-0 rounded-md bg-success/15 px-1.5 py-0.5 text-[11px] font-bold text-success">ниже средней</span>
                  )}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
                  <OperationBadge operation={l.operation} className="!px-1.5 !py-0 !text-[11px]" />
                  <ServerDot color={l.server.color} />
                  <span className="truncate">{l.sellerNickname}</span>
                  {l.sellerVerified && <span className="shrink-0 font-bold text-success">✔</span>}
                </span>
              </span>
              <span className="text-right font-mono text-[17px] font-bold text-accent-soft tabular" title={l.price ? formatPrice(l.price) : undefined}>
                {priceText(l.price, l.operation)}
              </span>
              <span className="hidden text-right text-[13px] text-muted md:block">{timeAgo(l.publishedAt)}</span>
            </Link>
            {onToggleFavorite && (
              <button
                type="button"
                aria-label={l.favorite ? "Убрать из избранного" : "В избранное"}
                aria-pressed={l.favorite}
                onClick={() => onToggleFavorite(l)}
                className={`absolute right-1.5 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-xl ${l.favorite ? "text-accent-ink" : "text-faint hover:text-ink"} hover:bg-surface-2`}
              >
                <Icon name="heart" size={18} fill={l.favorite ? "currentColor" : "none"} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
