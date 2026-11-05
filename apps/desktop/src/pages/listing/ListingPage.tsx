import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  DEAL_PLACE_LABELS,
  LISTING_STATUS_LABELS,
  SAFE_DEAL_TIPS,
  TRUSTED_SELLER,
  SURCHARGE_DIRECTION_LABELS,
  TRANSFER_MODE_LABELS,
  formatAttributeValue,
  formatPrice,
  formatPriceShort,
  type CatalogItemInfoDto,
  type ListingAttributeDto,
  type ListingDetailDto,
} from "@twm/shared";
import { CopyButton, copyText } from "../../components/CopyButton";
import { Icon } from "../../components/Icon";
import { LastSeen } from "../../components/LastSeen";
import { Media, OperationBadge, ServerDot, priceText } from "../../components/listing";
import { ReportDialog } from "../../components/ReportDialog";
import { Alert, Button, Card } from "../../components/ui";
import { ApiError, api, mediaSrc } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { shareUrl } from "../../lib/config";
import { useToast } from "../../lib/toast";
import { useLoad } from "../../lib/use-load";
import { OwnerStatsCard, PriceHistoryCard, SimilarListings } from "./ListingInsights";
import { PedModelCard } from "./PedModelCard";

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
        <Link to="/" className="font-bold text-accent-ink">
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
          {listing.status === "moderation"
            ? "Объявление на проверке у модератора — пока его видите только вы."
            : `Объявление не опубликовано (${LISTING_STATUS_LABELS[listing.status].toLowerCase()}). Его видите только вы${listing.isOwner ? "" : " и модераторы"}.`}
          {listing.moderationReason ? ` Причина проверки: ${listing.moderationReason}.` : ""}
          {listing.rejectionReason ? ` Причина отклонения: ${listing.rejectionReason}` : ""}
        </Alert>
      )}

      <div className="flex flex-wrap items-start gap-7">
        <section aria-label="Изображения и описание" className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <Gallery listing={listing} />

          {listing.catalogItem && <ItemPreviewCard item={listing.catalogItem} />}

          {/* Одежда в игре — это скин персонажа: ID одежды = номер модели персонажа. */}
          {listing.catalogItem?.gameCode && /одежд/i.test(listing.category?.name ?? "") && (
            <PedModelCard gameCode={listing.catalogItem.gameCode} name={listing.catalogItem.name} />
          )}

          {listing.attributes.length > 0 && (
            <Card className="flex flex-col gap-4">
              <h2 className="m-0 font-display text-[19px] font-bold">Характеристики</h2>
              <AttributeList items={listing.attributes} />
            </Card>
          )}

          {listing.catalogItem && (listing.sectionCode === "items" || listing.sectionCode === "cars") && <PriceHistoryCard listing={listing} />}

          {listing.want && (
            <Card className="flex flex-col gap-4 border-exchange/40">
              <h2 className="m-0 font-display text-[19px] font-bold text-exchange">Хочу получить взамен</h2>
              {listing.want.listingType && <p className="m-0 text-[15px] font-bold">{listing.want.listingType.name}</p>}
              {listing.want.attributes.length > 0 && <AttributeList items={listing.want.attributes} />}
              {listing.want.description && <p className="m-0 whitespace-pre-line leading-relaxed text-ink-2">{listing.want.description}</p>}
              {listing.want.surcharge !== null && listing.want.surchargeDirection && (
                <span className="self-start rounded-lg bg-exchange/15 px-3 py-1.5 font-mono font-bold text-exchange">
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
          <StickyBar listing={listing} />
          {listing.warnings.length > 0 && (
            <div role="note" className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-danger-line bg-danger-bg p-4 text-sm leading-snug text-danger-ink">
              <span className="font-extrabold">Будьте внимательны</span>
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
                {listing.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {listing.isOwner && listing.publishedAt && <OwnerStatsCard listing={listing} />}
          <SellerCard listing={listing} />
        </aside>
      </div>

      <SimilarListings key={listing.id} listingId={listing.id} />
    </div>
  );
}

/**
 * Предмет из справочника: ID в игре, предпросмотр (анимация, одежда) со звуком
 * и содержимое кейса. Всё это заполняет администратор.
 */
function ItemPreviewCard({ item }: { item: CatalogItemInfoDto }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  if (!item.preview && !item.audioUrl && item.contents.length === 0 && !item.gameCode) return null;

  const toggleSound = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    // Звук и видео — с начала, чтобы совпали.
    audio.currentTime = 0;
    if (videoRef.current) videoRef.current.currentTime = 0;
    audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="m-0 font-display text-[19px] font-bold">{item.contents.length > 0 ? "Что внутри" : "Предпросмотр"}</h2>
        {item.gameCode && <span className="font-mono text-sm text-muted">ID в игре: {item.gameCode}</span>}
      </div>

      {(item.preview || item.audioUrl) && (
        <div className="flex flex-wrap items-end gap-4">
          {item.preview && (
            <div className="flex aspect-square w-full max-w-[320px] items-center justify-center overflow-hidden rounded-xl bg-ground">
              {item.preview.kind === "video" ? (
                <video
                  ref={videoRef}
                  src={mediaSrc(item.preview.url)}
                  className="size-full object-contain"
                  autoPlay
                  muted
                  loop
                  playsInline
                  aria-label={`Предпросмотр: ${item.name}`}
                />
              ) : (
                <img src={mediaSrc(item.preview.url)} alt={`Предпросмотр: ${item.name}`} className="size-full object-contain" />
              )}
            </div>
          )}
          {item.audioUrl && (
            <>
              <audio ref={audioRef} src={mediaSrc(item.audioUrl)} loop={item.preview?.kind === "video"} onEnded={() => setPlaying(false)} preload="none" />
              <Button variant="secondary" onClick={toggleSound} aria-pressed={playing}>
                {playing ? "■ Выключить звук" : "♪ Включить звук"}
              </Button>
            </>
          )}
        </div>
      )}

      {item.contents.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2 p-0">
          {item.contents.map((entry, index) => (
            <li key={`${entry.name}-${index}`} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2">
              {entry.item ? (
                <Media media={entry.item.icon} alt="" fit="contain" className="size-10 shrink-0 rounded-lg" />
              ) : (
                <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ground text-faint">
                  •
                </span>
              )}
              <span className="flex min-w-0 flex-col">
                {entry.item ? (
                  <Link to={`/items?item=${entry.item.id}`} className="truncate font-semibold text-ink hover:text-accent-ink">
                    {entry.name}
                  </Link>
                ) : (
                  <span className="truncate font-semibold">{entry.name}</span>
                )}
                {entry.note && <span className="text-[13px] text-muted">{entry.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AttributeList({ items }: { items: ListingAttributeDto[] }) {
  const format = (a: ListingAttributeDto) => formatAttributeValue(a.value, a.unit);
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
            key={current.id}
            src={mediaSrc(current.fullUrl)}
            alt={`${listing.title} — изображение ${index + 1}`}
            className="zoom-in max-h-[calc(100%-96px)] max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <span className="absolute left-5 top-6 font-mono text-sm font-bold text-ink-2">
            {index + 1} / {images.length}
          </span>
          <button
            type="button"
            autoFocus
            onClick={() => setZoom(false)}
            className="absolute right-5 top-5 flex h-11 items-center gap-2 rounded-xl bg-surface px-4 font-bold text-ink"
          >
            <Icon name="close" size={16} strokeWidth={2.6} /> Закрыть
          </button>
          {images.length > 1 && (
            <div className="absolute inset-x-0 bottom-5 flex justify-center gap-2" onClick={(e) => e.stopPropagation()}>
              {images.map((image, i) => (
                <button
                  key={image.id}
                  type="button"
                  aria-label={`Изображение ${i + 1}`}
                  aria-pressed={i === index}
                  onClick={() => setIndex(i)}
                  className={`h-14 w-20 overflow-hidden rounded-lg border-2 transition-opacity ${i === index ? "border-accent" : "border-transparent opacity-60 hover:opacity-100"}`}
                >
                  <img src={mediaSrc(image.thumbUrl)} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
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
      <Icon name={side === "left" ? "chevronLeft" : "chevronRight"} size={22} strokeWidth={2.4} />
    </button>
  );
}

function PriceCard({ listing, onChange }: { listing: ListingDetailDto; onChange: (l: ListingDetailDto) => void }) {
  const { status } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  const writeSeller = async () => {
    if (status !== "authed") {
      navigate("/login", { state: { from: `/listing/${listing.id}` } });
      return;
    }
    setWriting(true);
    setWriteError(null);
    try {
      const conversation = await api.startConversation(listing.id);
      navigate(`/chats/${conversation.id}`);
    } catch (e) {
      setWriteError(e instanceof ApiError ? e.message : "Не удалось открыть переписку");
    } finally {
      setWriting(false);
    }
  };

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
    <Card id="price-card" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <OperationBadge operation={listing.operation} />
        <span className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-bold text-ink-2">{listing.listingType.name}</span>
        {listing.category && <span className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-bold text-ink-2">{listing.category.name}</span>}
        {listing.status === "active" && <ShareButton listingId={listing.id} />}
      </div>
      <h1 className="m-0 font-display text-[26px] font-bold leading-tight">{listing.title}</h1>
      <div className="font-mono text-[32px] font-bold leading-none text-accent-soft tabular">{priceText(listing.price, listing.operation)}</div>
      {listing.sectionCode === "items" && listing.quantity > 1 && <span className="text-sm text-muted">Количество: {listing.quantity} шт.</span>}

      {stats && diff !== null && listing.operation === "sell" && (
        <div className={`rounded-xl px-3.5 py-3 text-sm leading-snug ${diff <= -5 ? "bg-success/10 text-success-ink" : diff >= 15 ? "bg-danger/10 text-danger-ink" : "bg-surface-2 text-ink-2"}`}>
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
          <Button size="lg" loading={writing} onClick={() => void writeSeller()}>
            <Icon name="chat" size={18} />
            {listing.operation === "buy" ? "Написать покупателю" : "Написать продавцу"}
          </Button>
          {writeError && <span className="text-[13px] text-danger">{writeError}</span>}
          <Button variant="secondary" loading={busy} onClick={() => void toggleFavorite()}>
            <Icon name="heart" size={18} fill={listing.favorite ? "currentColor" : "none"} />
            {listing.favorite ? "В избранном" : "В избранное"}
          </Button>
          {status === "authed" && (
            <button type="button" onClick={() => setReporting(true)} className="self-center text-[13px] text-faint hover:text-danger">
              Пожаловаться на объявление
            </button>
          )}
          {reporting && <ReportDialog targetType="listing" targetId={listing.id} onClose={() => setReporting(false)} />}
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
          <Link to={`/user/${encodeURIComponent(seller.login)}`} className="text-base font-extrabold text-ink hover:text-accent-ink">
            {seller.login}
          </Link>
          <span className="text-[13px] text-muted">
            На площадке {memberFor(seller.memberSince)} · сделок: {seller.deals} · активных объявлений: {seller.activeListings}
          </span>
          <LastSeen at={seller.lastSeenAt} />
        </div>
      </div>
      {seller.trusted && (
        <span
          className="self-start rounded-lg bg-success/10 px-2.5 py-1 text-[13px] font-bold text-success-ink"
          title={`Не меньше ${TRUSTED_SELLER.minDeals} подтверждённых сделок, ${Math.round(TRUSTED_SELLER.minPositiveShare * 100)}% положительных отзывов, на площадке больше ${TRUSTED_SELLER.minAccountDays} дней`}
        >
          ★ Надёжный продавец
        </span>
      )}
      <Link
        to={`/user/${encodeURIComponent(seller.login)}`}
        className="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-ink-2 no-underline hover:text-ink"
      >
        <span className="font-mono font-bold text-success-ink">👍 {seller.reviews.positive}</span>
        <span className="font-mono font-bold text-danger-ink">👎 {seller.reviews.negative}</span>
        <span className="ml-auto">
          {seller.reviews.positive + seller.reviews.negative > 0 ? "Все отзывы →" : "Отзывов пока нет"}
        </span>
      </Link>
      <div className={`flex flex-col gap-1 rounded-xl border px-3.5 py-3 ${seller.nicknameVerified ? "border-success-line" : "border-dashed border-line-strong"}`}>
        <span className={`text-xs ${seller.nicknameVerified ? "font-bold text-success" : "text-muted"}`}>
          {seller.nicknameVerified ? "✔ Ник в игре подтверждён модератором" : "Ник в игре · указан продавцом, не проверен"}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="select-all font-mono font-bold">{seller.nickname}</span>
          <CopyButton text={seller.nickname} label="Скопировать ник" done={`Ник ${seller.nickname} скопирован — вставьте его в игре`} className="-my-1.5 -mr-1.5" />
        </span>
      </div>
      {seller.sameNicknameCount > 0 && (
        <div role="note" className="flex gap-2.5 rounded-xl bg-accent/10 px-3.5 py-3 text-[13px] leading-snug text-warn-ink">
          <span aria-hidden="true" className="font-bold text-accent-ink">
            !
          </span>
          <span>
            Этот ник указан ещё у {seller.sameNicknameCount}{" "}
            {seller.sameNicknameCount === 1 ? "пользователя" : "пользователей"} площадки. Перед сделкой сверьте ник в игре.
          </span>
        </div>
      )}
      <details className="group rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-ink-2">
        <summary className="cursor-pointer font-bold text-ink">Как не попасться мошенникам</summary>
        <ul className="m-0 mt-2 flex list-disc flex-col gap-1.5 pl-5 leading-snug">
          {SAFE_DEAL_TIPS.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </details>
      <p className="m-0 text-[13px] leading-relaxed text-faint">
        Площадка не участвует в сделке и не гарантирует передачу имущества. Торговля за реальные деньги запрещена.
      </p>
    </Card>
  );
}

/** «Поделиться»: ссылка на сайт площадки, в мессенджере она покажет карточку с ценой. */
function ShareButton({ listingId }: { listingId: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        void copyText(shareUrl(listingId)).then((ok) =>
          toast(ok ? "Ссылка скопирована — отправьте её в Discord, VK или Telegram" : "Не удалось скопировать ссылку", ok ? "ok" : "error"),
        )
      }
      className="ml-auto flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-bold text-muted transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <Icon name="link" size={15} /> Поделиться
    </button>
  );
}

/**
 * Когда карточка с ценой уходит за край экрана, сверху появляется полоса
 * с названием, ценой и кнопкой «Написать» — не нужно прокручивать назад.
 */
function StickyBar({ listing }: { listing: ListingDetailDto }) {
  const [visible, setVisible] = useState(false);
  const { status } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const card = document.getElementById("price-card");
    if (!card) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry!.isIntersecting && entry!.boundingClientRect.top < 0), {
      rootMargin: "-72px 0px 0px 0px",
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  if (listing.isOwner || listing.status !== "active") return null;

  const write = async () => {
    if (status !== "authed") {
      navigate("/login", { state: { from: `/listing/${listing.id}` } });
      return;
    }
    setBusy(true);
    try {
      const conversation = await api.startConversation(listing.id);
      navigate(`/chats/${conversation.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      aria-hidden={!visible}
      className={`fixed inset-x-0 top-[69px] z-20 border-b border-line-soft bg-ground/95 backdrop-blur-md transition-all duration-200 ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0"
      }`}
    >
      <div className="mx-auto flex max-w-[1280px] items-center gap-4 px-6 py-2.5">
        <span className="min-w-0 flex-1 truncate font-bold">{listing.title}</span>
        <span className="flex items-center gap-1.5 text-[13px] text-muted">
          <ServerDot color={listing.server.color} /> {listing.server.name}
        </span>
        <span className="font-mono text-lg font-bold text-accent-soft tabular">{priceText(listing.price, listing.operation)}</span>
        <Button loading={busy} tabIndex={visible ? 0 : -1} onClick={() => void write()} className="h-10">
          <Icon name="chat" size={17} />
          {listing.operation === "buy" ? "Написать покупателю" : "Написать продавцу"}
        </Button>
      </div>
    </div>
  );
}
