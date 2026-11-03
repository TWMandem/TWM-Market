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
  buy: "bg-[#6cb4ff]/20 text-buy",
  exchange: "bg-[#b79cff]/20 text-exchange",
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
}: {
  listing: ListingCardDto;
  onToggleFavorite?: ((listing: ListingCardDto) => void) | undefined;
}) {
  const isItem = listing.sectionCode === "items";
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-[18px] border border-line bg-surface transition-colors hover:border-faint">
      <Link to={`/listing/${listing.id}`} className="flex flex-1 flex-col text-ink no-underline">
        <div className="relative h-[150px] bg-surface-2">
          <Media media={listing.image} alt={listing.title} fit={isItem && listing.image?.kind !== "image" ? "contain" : "cover"} className="size-full" />
          <OperationBadge operation={listing.operation} className="absolute left-3 top-3" />
          {listing.belowAverage && (
            <span className="absolute bottom-3 left-3 rounded-lg bg-[#4cd48a]/20 px-2.5 py-1 text-xs font-bold text-success backdrop-blur">
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
            listing.favorite ? "text-accent" : "text-ink"
          } hover:bg-black/30`}
        >
          <Icon name="heart" size={20} fill={listing.favorite ? "currentColor" : "none"} />
        </button>
      )}
    </article>
  );
}

export function ListingGrid({
  items,
  onToggleFavorite,
}: {
  items: ListingCardDto[];
  onToggleFavorite?: ((listing: ListingCardDto) => void) | undefined;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
      {items.map((item) => (
        <ListingCard key={item.id} listing={item} onToggleFavorite={onToggleFavorite} />
      ))}
    </div>
  );
}
