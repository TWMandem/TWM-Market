import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  DEAL_PLACE_LABELS,
  SURCHARGE_DIRECTION_LABELS,
  TRANSFER_MODE_LABELS,
  formatPrice,
  formatPriceShort,
  type ListingAttributeDto,
  type ListingDetailDto,
} from "@twm/shared";
import { Icon } from "../../components/Icon";
import { Media, OperationBadge, ServerDot, priceText } from "../../components/listing";
import { Alert, Button, Card } from "../../components/ui";
import { api, mediaSrc } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useLoad } from "../../lib/use-load";

const SECTION_LINKS = { items: ["/items", "Рынок предметов"], cars: ["/cars", "Авторынок"], notary: ["/notary", "Нотариус"] } as const;

const date = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

function memberFor(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "меньше дня";
  if (days < 31) return `${days} дн.`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} мес.`;
  return `${Math.floor(months / 12)} г.`;
}

export function ListingPage() {
  const { id = "" } = useParams();
  const { data: listing, setData, error } = useLoad(() => api.listing(id), [id]);

  if (error) {
    return (
      <div className="flex flex-col items-start gap-4">
        <Alert>{error}</Alert>
        <Link to="/" className="font-bold text-accent">
          На главную →
        </Link>
      </div>
    );
  }
  if (!listing) return <p className="text-muted">Загружаю…</p>;

  const [sectionPath, sectionName] = SECTION_LINKS[listing.sectionCode];

  return (
    <div className="flex flex-col gap-7">
      <nav aria-label="Хлебные крошки" className="text-sm text-muted">
        <Link to="/" className="text-muted hover:text-ink">
          Главная
        </Link>{" "}
        /{" "}
        <Link to={sectionPath} className="text-muted hover:text-ink">
          {sectionName}
        </Link>{" "}
        / {listing.title}
      </nav>

      {listing.status !== "active" && (
        <Alert tone="warning">
          Объявление не опубликовано (статус: {listing.status}). Его видите только вы
          {listing.isOwner ? "" : " и модераторы"}.
          {listing.rejectionReason ? ` Причина отклонения: ${listing.rejectionReason}` : ""}
        </Alert>
      )}

      <div className="flex flex-wrap items-start gap-7">
        <section aria-label="Изображения и описание" className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <Gallery listing={listing} />

          {listing.attributes.length > 0 && (
            <Card className="flex flex-col gap-4">
              <h2 className="m-0 font-display text-[19px] font-bold">Характеристики</h2>
              <AttributeList items={listing.attributes} />
            </Card>
          )}

          {listing.want && (
            <Card className="flex flex-col gap-4 border-[#4a4266]">
              <h2 className="m-0 font-display text-[19px] font-bold text-exchange">Хочу получить взамен</h2>
              {listing.want.listingType && <p className="m-0 text-[15px] font-bold">{listing.want.listingType.name}</p>}
              {listing.want.attributes.length > 0 && <AttributeList items={listing.want.attributes} />}
              {listing.want.description && <p className="m-0 whitespace-pre-line leading-relaxed text-ink-2">{listing.want.description}</p>}
              {listing.want.surcharge !== null && listing.want.surchargeDirection && (
                <span className="self-start rounded-lg bg-[#b79cff]/15 px-3 py-1.5 font-mono font-bold text-[#d6c9ff]">
                  {SURCHARGE_DIRECTION_LABELS[listing.want.surchargeDirection]}: {formatPrice(listing.want.surcharge)}
                </span>
              )}
            </Card>
          )}

          {listing.description && (
            <Card className="flex flex-col gap-3">
              <h2 className="m-0 font-display text-[19px] font-bold">Описание продавца</h2>
              <p className="m-0 whitespace-pre-line leading-relaxed text-ink-2">{listing.description}</p>
            </Card>
          )}
        </section>

        <aside aria-label="Цена и продавец" className="flex min-w-0 flex-[1_1_340px] flex-col gap-4 lg:max-w-[420px]">
          <PriceCard listing={listing} onChange={setData} />
          <SellerCard listing={listing} />
        </aside>
      </div>
    </div>
  );
}

function AttributeList({ items }: { items: ListingAttributeDto[] }) {
  const format = (a: ListingAttributeDto) => {
    if (typeof a.value === "boolean") return a.value ? "Да" : "Нет";
    if (Array.isArray(a.value)) return a.value.join(", ");
    return `${typeof a.value === "number" ? a.value.toLocaleString("ru-RU") : a.value}${a.unit ? ` ${a.unit}` : ""}`;
  };
  return (
    <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-8">
      {items.map((a) => (
        <div key={a.key} className="flex justify-between gap-3 border-b border-line-soft py-3">
          <dt className="text-muted">{a.label}</dt>
          <dd className="m-0 text-right font-mono font-bold">{format(a)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Gallery({ listing }: { listing: ListingDetailDto }) {
  const images = listing.images;
  const [index, setIndex] = useState(() => Math.max(0, images.findIndex((i) => i.isMain)));
  const [zoom, setZoom] = useState(false);
  const current = images[index];

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(false);
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % images.length);
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom, images.length]);

  if (!current) {
    const icon = listing.catalogItem?.icon ?? null;
    return (
      <div className="flex aspect-[16/9] items-center justify-center overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        <Media media={icon} alt={listing.title} fit="contain" className="size-2/3" />
      </div>
    );
  }

  const step = (d: number) => setIndex((i) => (i + d + images.length) % images.length);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[16/9] overflow-hidden rounded-[var(--radius-card)] border border-line bg-black">
        <img src={mediaSrc(current.fullUrl)} alt={`${listing.title} — изображение ${index + 1}`} className="size-full object-contain" />
        {images.length > 1 && (
          <>
            <GalleryArrow side="left" onClick={() => step(-1)} />
            <GalleryArrow side="right" onClick={() => step(1)} />
          </>
        )}
        <button
          type="button"
          onClick={() => setZoom(true)}
          className="absolute bottom-3 right-3 flex h-10 items-center gap-1.5 rounded-[10px] bg-ground/80 px-3 text-[13px] font-bold text-ink hover:bg-ground"
        >
          На весь экран · {index + 1} / {images.length}
        </button>
      </div>
      {images.length > 1 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2.5">
          {images.map((image, i) => (
            <button
              key={image.id}
              type="button"
              aria-label={`Изображение ${i + 1}${image.isMain ? ", главное" : ""}`}
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
              className={`aspect-[16/10] overflow-hidden rounded-xl border-2 ${i === index ? "border-accent" : "border-line"}`}
            >
              <img src={mediaSrc(image.thumbUrl)} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {zoom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр изображения"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6"
          onClick={() => setZoom(false)}
        >
          <img
            src={mediaSrc(current.fullUrl)}
            alt={`${listing.title} — изображение ${index + 1}`}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            autoFocus
            onClick={() => setZoom(false)}
            className="absolute right-5 top-5 h-11 rounded-xl bg-surface px-4 font-bold text-ink"
          >
            Закрыть (Esc)
          </button>
          {images.length > 1 && (
            <>
              <GalleryArrow side="left" onClick={(e) => (e.stopPropagation(), step(-1))} />
              <GalleryArrow side="right" onClick={(e) => (e.stopPropagation(), step(1))} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function GalleryArrow({ side, onClick }: { side: "left" | "right"; onClick: (e: MouseEvent) => void }) {
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Предыдущее изображение" : "Следующее изображение"}
      onClick={onClick}
      className={`absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-ground/75 text-xl text-ink hover:bg-ground ${
        side === "left" ? "left-3" : "right-3"
      }`}
    >
      <span aria-hidden="true">{side === "left" ? "‹" : "›"}</span>
    </button>
  );
}

function PriceCard({ listing, onChange }: { listing: ListingDetailDto; onChange: (l: ListingDetailDto) => void }) {
  const { status } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const toggleFavorite = async () => {
    if (status !== "authed") {
      navigate("/login", { state: { from: `/listing/${listing.id}` } });
      return;
    }
    setBusy(true);
    try {
      await api.favorite(listing.id, !listing.favorite);
      onChange({ ...listing, favorite: !listing.favorite });
    } finally {
      setBusy(false);
    }
  };

  const stats = listing.priceStats;
  const diff = stats && listing.price !== null ? Math.round(((listing.price - stats.average) / stats.average) * 100) : null;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <OperationBadge operation={listing.operation} />
        <span className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-bold text-ink-2">{listing.listingType.name}</span>
        {listing.category && <span className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-bold text-ink-2">{listing.category.name}</span>}
      </div>
      <h1 className="m-0 font-display text-[26px] font-bold leading-tight">{listing.title}</h1>
      <div className="font-mono text-[32px] font-bold leading-none text-accent-soft tabular">{priceText(listing.price, listing.operation)}</div>
      {listing.sectionCode === "items" && listing.quantity > 1 && <span className="text-sm text-muted">Количество: {listing.quantity} шт.</span>}

      {stats && diff !== null && listing.operation === "sell" && (
        <div className={`rounded-xl px-3.5 py-3 text-sm leading-snug ${diff <= -5 ? "bg-[#4cd48a]/10 text-[#9eebc0]" : diff >= 15 ? "bg-[#ff6b6b]/10 text-[#ffc4c4]" : "bg-surface-2 text-ink-2"}`}>
          {diff === 0 ? "Как средняя цена" : diff < 0 ? `На ${-diff}% ниже средней` : `На ${diff}% выше средней`} на {listing.server.name}:{" "}
          <span className="font-mono font-bold">{formatPriceShort(stats.average)}</span> по {stats.count} объявл. (от{" "}
          {formatPriceShort(stats.min)} до {formatPriceShort(stats.max)})
        </div>
      )}

      <dl className="m-0 flex flex-col gap-2.5 text-sm">
        <Row label="Сервер">
          <span className="flex items-center gap-1.5">
            <ServerDot color={listing.server.color} />
            {listing.server.name}
          </span>
        </Row>
        <Row label="Перевод">{TRANSFER_MODE_LABELS[listing.transferMode]}</Row>
        {listing.dealPlaces.length > 0 && <Row label="Способ сделки">{listing.dealPlaces.map((p) => DEAL_PLACE_LABELS[p]).join(" · ")}</Row>}
        {listing.publishedAt && <Row label="Опубликовано">{date(listing.publishedAt)}</Row>}
        <Row label="Просмотров">{listing.views.toLocaleString("ru-RU")}</Row>
      </dl>

      {listing.isOwner ? (
        <Link
          to={`/listings/${listing.id}/edit`}
          className="flex h-[52px] items-center justify-center rounded-xl bg-accent font-extrabold text-on-accent no-underline hover:bg-accent-soft"
        >
          Редактировать
        </Link>
      ) : (
        <>
          <Button size="lg" disabled title="Чат появится в следующем обновлении">
            Написать продавцу — скоро
          </Button>
          <Button variant="secondary" loading={busy} onClick={() => void toggleFavorite()}>
            <Icon name="heart" size={18} fill={listing.favorite ? "currentColor" : "none"} />
            {listing.favorite ? "В избранном" : "В избранное"}
          </Button>
        </>
      )}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="m-0 text-right font-bold">{children}</dd>
    </div>
  );
}

function SellerCard({ listing }: { listing: ListingDetailDto }) {
  const seller = listing.seller;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-line font-extrabold uppercase">
          {seller.login.slice(0, 2)}
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-base font-extrabold">{seller.login}</span>
          <span className="text-[13px] text-muted">
            На площадке {memberFor(seller.memberSince)} · активных объявлений: {seller.activeListings}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1 rounded-xl border border-dashed border-[#3a404c] px-3.5 py-3">
        <span className="text-xs text-muted">Ник в игре · {seller.nicknameVerified ? "подтверждён" : "указан продавцом"}</span>
        <span className="select-all font-mono font-bold">{seller.nickname}</span>
      </div>
      {seller.sameNicknameCount > 0 && (
        <div role="note" className="flex gap-2.5 rounded-xl bg-accent/10 px-3.5 py-3 text-[13px] leading-snug text-[#e8d3a6]">
          <span aria-hidden="true" className="font-bold text-accent">
            !
          </span>
          <span>
            Этот ник указан ещё у {seller.sameNicknameCount}{" "}
            {seller.sameNicknameCount === 1 ? "пользователя" : "пользователей"} площадки. Перед сделкой сверьте ник в игре.
          </span>
        </div>
      )}
      <p className="m-0 text-[13px] leading-relaxed text-faint">
        Площадка не участвует в сделке и не гарантирует передачу имущества. Торговля за реальные деньги запрещена.
      </p>
    </Card>
  );
}
