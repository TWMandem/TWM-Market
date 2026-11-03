import { useState } from "react";
import { Link } from "react-router";
import { LISTING_STATUS_LABELS, type ListingStatus } from "@twm/shared";
import { Media, OperationBadge, ServerDot, priceText } from "../../components/listing";
import { Alert, Button } from "../../components/ui";
import { api } from "../../lib/api";
import { attempt, useLoad } from "../../lib/use-load";

const TABS: ListingStatus[] = ["active", "draft", "moderation", "rejected", "withdrawn", "archived", "sold"];

const STATUS_STYLES: Record<ListingStatus, string> = {
  active: "bg-[#4cd48a]/15 text-success",
  draft: "bg-line text-ink-2",
  moderation: "bg-accent/15 text-accent-soft",
  rejected: "bg-[#ff6b6b]/15 text-[#ffb4b4]",
  sold: "bg-[#6cb4ff]/15 text-buy",
  withdrawn: "bg-line text-ink-2",
  archived: "bg-line text-ink-2",
};

function expiresText(iso: string | null): { text: string; soon: boolean } {
  if (!iso) return { text: "", soon: false };
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return { text: "Срок истёк", soon: true };
  return { text: days === 1 ? "Истекает завтра" : `Истекает через ${days} дн.`, soon: days <= 3 };
}

export function MyListingsPage() {
  const [tab, setTab] = useState<ListingStatus>("active");
  const { data, error, reload } = useLoad(() => api.myListings(tab), [tab]);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setActionError(await attempt(action));
    setBusy(null);
    await reload();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0 font-display text-[28px] font-bold">Мои объявления</h1>
        <Link to="/listings/new" className="flex h-11 items-center rounded-xl bg-accent px-4 font-extrabold text-on-accent no-underline hover:bg-accent-soft">
          + Новое объявление
        </Link>
      </div>

      <div role="tablist" aria-label="Статус" className="flex flex-wrap gap-1.5 border-b border-line-soft pb-2.5">
        {TABS.map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={tab === status}
            onClick={() => setTab(status)}
            className={`h-10 rounded-[10px] px-3.5 text-sm font-bold ${tab === status ? "bg-line text-ink" : "text-muted hover:text-ink"}`}
          >
            {LISTING_STATUS_LABELS[status]} <span className="font-mono opacity-80">{data?.counts[status] ?? 0}</span>
          </button>
        ))}
      </div>

      {(error || actionError) && <Alert>{error ?? actionError}</Alert>}

      <div role="tabpanel" className="flex flex-col gap-3">
        {data && data.items.length === 0 && <p className="m-0 py-8 text-center text-muted">Здесь пока пусто.</p>}
        {data?.items.map((item) => {
          const exp = expiresText(item.status === "active" ? item.expiresAt : null);
          const key = (a: string) => `${item.id}:${a}`;
          return (
            <article key={item.id} className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-3.5">
              <Link to={`/listing/${item.id}`} className="block h-20 w-32 shrink-0 overflow-hidden rounded-[10px] bg-surface-2">
                <Media media={item.image} alt="" className="size-full" fit={item.image?.kind === "image" ? "cover" : "contain"} />
              </Link>
              <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/listing/${item.id}`} className="text-base font-bold text-ink no-underline hover:text-accent">
                    {item.title}
                  </Link>
                  <OperationBadge operation={item.operation} />
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-extrabold ${STATUS_STYLES[item.status]}`}>{LISTING_STATUS_LABELS[item.status]}</span>
                </div>
                <span className="font-mono font-bold text-accent-soft">{priceText(item.price, item.operation)}</span>
                <span className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
                  <span className="flex items-center gap-1.5">
                    <ServerDot color={item.server.color} />
                    {item.sellerNickname}
                  </span>
                  {exp.text && <span className={exp.soon ? "font-bold text-accent-soft" : ""}>{exp.text}</span>}
                  {item.rejectionReason && <span className="text-[#ffb4b4]">Причина: {item.rejectionReason}</span>}
                  {item.status === "moderation" && (
                    <span className="text-[#e8d3a6]">На проверке{item.moderationReason ? `: ${item.moderationReason}` : ""}</span>
                  )}
                </span>
              </div>
              <div className="flex gap-5 text-[13px] text-muted">
                <span>
                  <span className="font-mono font-bold text-ink">{item.views}</span> просм.
                </span>
                <span>
                  <span className="font-mono font-bold text-ink">{item.favorites}</span> в избр.
                </span>
                {item.publishedAt && (
                  <Link to={`/listing/${item.id}`} className="font-bold text-accent no-underline hover:text-accent-soft">
                    Статистика →
                  </Link>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {item.status === "active" && item.bumpAvailableAt && (
                  <BumpButton
                    availableAt={item.bumpAvailableAt}
                    loading={busy === key("bump")}
                    onBump={() => void run(key("bump"), () => api.listingAction(item.id, "bump"))}
                  />
                )}
                {item.status === "active" && (
                  <>
                    <Button variant={exp.soon ? "primary" : "secondary"} loading={busy === key("extend")} onClick={() => void run(key("extend"), () => api.listingAction(item.id, "extend"))}>
                      Продлить
                    </Button>
                    <Button variant="secondary" loading={busy === key("sold")} onClick={() => void run(key("sold"), () => api.listingAction(item.id, "sold"))}>
                      Продано
                    </Button>
                    <Button variant="ghost" loading={busy === key("withdraw")} onClick={() => void run(key("withdraw"), () => api.listingAction(item.id, "withdraw"))}>
                      Снять
                    </Button>
                  </>
                )}
                {["draft", "withdrawn", "archived", "rejected"].includes(item.status) && (
                  <Button loading={busy === key("publish")} onClick={() => void run(key("publish"), () => api.listingAction(item.id, "publish"))}>
                    {item.status === "draft" ? "Опубликовать" : "Опубликовать снова"}
                  </Button>
                )}
                {item.status !== "sold" && item.status !== "moderation" && (
                  <Link to={`/listings/${item.id}/edit`} className="flex h-11 items-center rounded-xl border border-line px-4 font-bold text-ink no-underline hover:border-faint">
                    Изменить
                  </Link>
                )}
                {item.status === "draft" && (
                  <Button variant="danger" loading={busy === key("delete")} onClick={() => void run(key("delete"), () => api.deleteListing(item.id))}>
                    Удалить
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/** «Поднять» — раз в сутки; до этого кнопка показывает, когда станет доступна. */
function BumpButton({ availableAt, loading, onBump }: { availableAt: string; loading: boolean; onBump: () => void }) {
  const wait = new Date(availableAt).getTime() - Date.now();
  if (wait > 0) {
    const hours = Math.ceil(wait / 3_600_000);
    return (
      <Button variant="secondary" disabled title="Поднимать объявление можно раз в сутки">
        Поднять через {hours} ч
      </Button>
    );
  }
  return (
    <Button loading={loading} onClick={onBump} title="Объявление окажется вверху «Новых». Раз в сутки.">
      ↑ Поднять
    </Button>
  );
}
