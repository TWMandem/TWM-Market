import { useCallback } from "react";
import { Link } from "react-router";
import { ListingGrid } from "../../components/listing";
import { Alert } from "../../components/ui";
import { api } from "../../lib/api";
import { useFavoriteToggle } from "../../lib/catalog";
import { useLoad } from "../../lib/use-load";

export function FavoritesPage() {
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

  return (
    <div className="flex flex-col gap-5">
      <h1 className="m-0 font-display text-[28px] font-bold">Избранное</h1>
      {error && <Alert>{error}</Alert>}
      {data && data.items.length === 0 && (
        <p className="m-0 text-muted">
          Пока пусто. Нажмите на сердечко в карточке объявления, чтобы сохранить его.{" "}
          <Link to="/items" className="font-bold text-accent">
            В каталог →
          </Link>
        </p>
      )}
      {active.length > 0 && <ListingGrid items={active} onToggleFavorite={(l) => void toggle(l)} />}
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
