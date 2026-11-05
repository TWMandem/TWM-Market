import { useCallback } from "react";
import { Link } from "react-router";
import { formatPrice, type FavoriteItemDto } from "@twm/shared";
import { Icon } from "../../components/Icon";
import { ListingGrid } from "../../components/listing";
import { Alert } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useFavoriteToggle } from "../../lib/catalog";
import { useLoad } from "../../lib/use-load";

/** Стала ли цена выгоднее с момента добавления: для продажи — ниже, для скупки — выше. */
function priceChange(item: FavoriteItemDto): { better: boolean; percent: number } | null {
  if (item.addedPrice === null || item.price === null || item.addedPrice === item.price || item.operation === "exchange") return null;
  const better = item.operation === "buy" ? item.price > item.addedPrice : item.price < item.addedPrice;
  return { better, percent: (Math.abs(item.price - item.addedPrice) / item.addedPrice) * 100 };
}

function PriceChange({ item }: { item: FavoriteItemDto }) {
  const change = priceChange(item);
  if (!change || item.addedPrice === null) return null;
  const sign = (item.price ?? 0) < item.addedPrice ? "−" : "+";
  const percent = change.percent < 1 ? "<1" : String(Math.round(change.percent));
  return (
    <span title="Цена, когда вы добавили объявление в избранное" className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
      <s className="font-mono text-faint tabular">{formatPrice(item.addedPrice)}</s>
      <span className={`rounded-md px-1.5 py-0.5 text-xs font-bold ${change.better ? "bg-success/15 text-success" : "bg-surface-2 text-muted"}`}>
        {sign}
        {percent}%
      </span>
    </span>
  );
}

export function FavoritesPage() {
  const { user } = useAuth();
  const { data, setData, error } = useLoad(() => api.favorites(), []);
  const toggle = useFavoriteToggle(
    useCallback(
      (id: string, favorite: boolean) =>
        setData((d) => (d ? { items: d.items.map((i) => (i.id === id ? { ...i, favorite } : i)) } : d)),
      [setData],
    ),
  );

  const active = data?.items.filter((i) => i.status === "active") ?? [];
  const closed = data?.items.filter((i) => i.status !== "active") ?? [];
  const cheaper = active.filter((i) => priceChange(i)?.better).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-display text-[28px] font-bold">Избранное</h1>
          {data && data.items.length > 0 && (
            <p className="m-0 text-sm text-muted">
              {user?.notifyFavorites === false ? (
                <>
                  Уведомления об изменениях выключены.{" "}
                  <Link to="/account#notifications" className="font-bold text-accent-ink">
                    Включить
                  </Link>
                </>
              ) : (
                <>
                  Сообщим, если цена станет выгоднее или объявление снимут.{" "}
                  <Link to="/account#notifications" className="font-bold text-accent-ink">
                    Настроить
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
        {cheaper > 0 && (
          <span className="flex items-center gap-1.5 rounded-xl bg-success/15 px-3 py-1.5 text-sm font-bold text-success">
            <Icon name="trendDown" size={16} />
            Выгоднее, чем при добавлении: {cheaper}
          </span>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      {data && data.items.length === 0 && (
        <p className="m-0 text-muted">
          Пока пусто. Нажмите на сердечко в карточке объявления, чтобы сохранить его — мы сообщим, если оно подешевеет или его снимут.{" "}
          <Link to="/items" className="font-bold text-accent-ink">
            В каталог →
          </Link>
        </p>
      )}
      {active.length > 0 && <ListingGrid items={active} onToggleFavorite={(l) => void toggle(l)} priceNote={(i) => <PriceChange item={i} />} />}
      {closed.length > 0 && (
        <>
          <h2 className="m-0 mt-4 text-base font-extrabold text-muted">Уже не продаются</h2>
          <div className="opacity-60">
            <ListingGrid items={closed} onToggleFavorite={(l) => void toggle(l)} />
          </div>
        </>
      )}
    </div>
  );
}
