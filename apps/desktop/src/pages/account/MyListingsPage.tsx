import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { LISTING_STATUS_LABELS, type ListingStatus } from "@twm/shared";
import { ActionMenu, type ActionItem } from "../../components/ActionMenu";
import { Icon } from "../../components/Icon";
import { Media, OperationBadge, ServerDot, priceText } from "../../components/listing";
import { Alert, Button } from "../../components/ui";
import { api } from "../../lib/api";
import { useToast } from "../../lib/toast";
import { attempt, useLoad } from "../../lib/use-load";

const TABS: ListingStatus[] = ["active", "draft", "moderation", "rejected", "withdrawn", "archived", "sold"];

const STATUS_STYLES: Record<ListingStatus, string> = {
  active: "bg-success/15 text-success",
  draft: "bg-line text-ink-2",
  moderation: "bg-accent/15 text-accent-soft",
  rejected: "bg-danger/15 text-danger-ink",
  sold: "bg-buy/15 text-buy",
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
  const navigate = useNavigate();

  const toast = useToast();
  const DONE: Record<string, string> = {
    extend: "Объявление продлено на 14 дней",
    bump: "Объявление поднято вверх «Новых»",
    sold: "Отмечено как проданное",
    withdraw: "Объявление снято с публикации",
    publish: "Объявление опубликовано",
    delete: "Черновик удалён",
  };
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    const failed = await attempt(action);
    setActionError(failed);
    setBusy(null);
    if (!failed) toast(DONE[key.split(":")[1] ?? ""] ?? "Готово");
    await reload();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0 font-display text-[28px] font-bold">Мои объявления</h1>
      </div>

      <div role="tablist" aria-label="Статус" className="flex flex-wrap gap-1.5 border-b border-line-soft pb-2.5">
        {TABS.map((status) => {
          const count = data?.counts[status] ?? 0;
          return (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={tab === status}
              onClick={() => setTab(status)}
              className={`flex h-10 items-center gap-2 rounded-[10px] px-3.5 text-sm font-bold transition-colors ${
                tab === status ? "bg-line text-ink" : count === 0 ? "text-faint/70 hover:text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {LISTING_STATUS_LABELS[status]}
              {count > 0 && (
                <span className={`rounded-md px-1.5 font-mono text-[12px] ${tab === status ? "bg-ground/60" : "bg-surface-2"}`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {(error || actionError) && <Alert>{error ?? actionError}</Alert>}

      <div role="tabpanel" className="flex flex-col gap-2.5">
        {data && data.items.length === 0 && <EmptyTab status={tab} />}
        {data?.items.map((item) => {
          const exp = expiresText(item.status === "active" ? item.expiresAt : null);
          const key = (a: string) => `${item.id}:${a}`;
          const act = (a: "extend" | "sold" | "withdraw" | "publish" | "bump") => () => void run(key(a), () => api.listingAction(item.id, a));
          const editable = item.status !== "sold" && item.status !== "moderation";
          const menu: ActionItem[] = [];
          if (item.publishedAt) menu.push({ label: "Статистика", hint: "Просмотры по дням, место по цене", onSelect: () => navigate(`/listing/${item.id}`) });
          if (item.status === "active") {
            if (!exp.soon) menu.push({ label: "Продлить на 14 дней", onSelect: act("extend") });
            menu.push({ label: "Снять с публикации", hint: "Можно опубликовать снова", onSelect: act("withdraw") });
            menu.push({ label: "Продано", hint: "Объявление закроется насовсем", confirm: "Нажмите ещё раз: продано", onSelect: act("sold") });
          }
          if (item.status === "draft") menu.push({ label: "Удалить черновик", danger: true, confirm: "Нажмите ещё раз: удалить", onSelect: () => void run(key("delete"), () => api.deleteListing(item.id)) });

          return (
            <article
              key={item.id}
              className="group grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 rounded-2xl border border-line bg-surface p-3 transition-colors hover:border-line-strong md:grid-cols-[96px_minmax(0,1fr)_auto_auto]"
            >
              <Link to={`/listing/${item.id}`} className="block h-16 w-24 overflow-hidden rounded-[10px] bg-surface-2" tabIndex={-1}>
                <Media media={item.image} alt="" className="size-full" fit={item.image?.kind === "image" ? "cover" : "contain"} />
              </Link>
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Link to={`/listing/${item.id}`} className="truncate text-[15px] font-bold text-ink no-underline hover:text-accent-ink">
                    {item.title}
                  </Link>
                  <OperationBadge operation={item.operation} />
                  {item.status !== tab && (
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-extrabold ${STATUS_STYLES[item.status]}`}>{LISTING_STATUS_LABELS[item.status]}</span>
                  )}
                </div>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-muted">
                  <span className="font-mono text-[15px] font-bold text-accent-soft">{priceText(item.price, item.operation)}</span>
                  <span className="flex items-center gap-1.5">
                    <ServerDot color={item.server.color} />
                    {item.sellerNickname}
                  </span>
                  {exp.text && <span className={exp.soon ? "font-bold text-accent-soft" : ""}>{exp.text}</span>}
                </span>
                {item.rejectionReason && <span className="text-[13px] text-danger-ink">Причина отклонения: {item.rejectionReason}</span>}
                {item.status === "moderation" && (
                  <span className="text-[13px] text-warn-ink">На проверке у модератора{item.moderationReason ? `: ${item.moderationReason}` : ""}</span>
                )}
              </div>

              <div className="col-span-2 flex items-center gap-4 text-[13px] text-muted md:col-span-1 md:justify-end" aria-label="Статистика">
                <span className="flex items-center gap-1.5" title="Просмотры">
                  <Icon name="eye" size={16} />
                  <span className="font-mono font-bold text-ink">{item.views}</span>
                </span>
                <span className="flex items-center gap-1.5" title="В избранном">
                  <Icon name="heart" size={15} />
                  <span className="font-mono font-bold text-ink">{item.favorites}</span>
                </span>
              </div>

              <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1 md:justify-end">
                {item.status === "active" && exp.soon && (
                  <Button loading={busy === key("extend")} onClick={act("extend")}>
                    Продлить
                  </Button>
                )}
                {item.status === "active" && !exp.soon && item.bumpAvailableAt && (
                  <BumpButton availableAt={item.bumpAvailableAt} loading={busy === key("bump")} onBump={act("bump")} />
                )}
                {["draft", "withdrawn", "archived", "rejected"].includes(item.status) && (
                  <Button loading={busy === key("publish")} onClick={act("publish")}>
                    {item.status === "draft" ? "Опубликовать" : "Опубликовать снова"}
                  </Button>
                )}
                {editable && (
                  <Link
                    to={`/listings/${item.id}/edit`}
                    className="flex h-11 items-center rounded-xl border border-line px-4 font-bold text-ink no-underline transition-colors hover:border-faint"
                  >
                    Изменить
                  </Link>
                )}
                <ActionMenu items={menu} label={`Ещё действия: ${item.title}`} />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/** Пустая вкладка: что сюда попадает и что делать. */
function EmptyTab({ status }: { status: ListingStatus }) {
  const text: Record<ListingStatus, string> = {
    active: "Активных объявлений нет. Разместите первое — его увидят игроки вашего сервера.",
    draft: "Черновиков нет. Черновик сохраняется, если нажать «Сохранить черновик» в форме объявления.",
    moderation: "На проверке ничего нет. Сюда попадают объявления со стоп-словами и те, на которые пожаловались.",
    rejected: "Отклонённых объявлений нет.",
    withdrawn: "Снятых с публикации объявлений нет.",
    archived: "Архив пуст. Сюда уходят объявления, срок которых истёк.",
    sold: "Проданных пока нет. Отметьте объявление проданным в меню «⋯», когда сделка состоится.",
  };
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <p className="m-0 max-w-[440px] leading-relaxed text-muted">{text[status]}</p>
      {status === "active" && (
        <Link to="/listings/new" className="flex h-11 items-center gap-2 rounded-xl bg-accent px-4 font-extrabold text-on-accent no-underline hover:bg-accent-soft">
          <Icon name="plus" size={18} strokeWidth={2.6} />
          Разместить объявление
        </Link>
      )}
    </div>
  );
}

/** «Поднять» — раз в сутки; до этого кнопка показывает, когда станет доступна. */
function BumpButton({ availableAt, loading, onBump }: { availableAt: string; loading: boolean; onBump: () => void }) {
  const wait = new Date(availableAt).getTime() - Date.now();
  if (wait > 0) {
    const hours = Math.ceil(wait / 3_600_000);
    return (
      <span className="flex h-11 items-center gap-1.5 px-2 text-[13px] text-faint" title="Поднимать объявление можно раз в сутки">
        <Icon name="clock" size={15} />
        Поднять через {hours} ч
      </span>
    );
  }
  return (
    <Button variant="secondary" loading={loading} onClick={onBump} title="Объявление окажется вверху «Новых». Раз в сутки.">
      <Icon name="arrowUp" size={16} strokeWidth={2.4} />
      Поднять
    </Button>
  );
}
