import { useCallback, useState } from "react";
import { PRICE_HISTORY_DAYS, formatPriceShort, type ListingCardDto, type ListingDetailDto, type PriceHistoryDays } from "@twm/shared";
import { TimeChart, daysBefore, dayLabel, fillDays, mskToday } from "../../components/charts";
import { ListingGrid, ServerDot } from "../../components/listing";
import { Alert, Card } from "../../components/ui";
import { api } from "../../lib/api";
import { useFavoriteToggle } from "../../lib/catalog";
import { useLoad } from "../../lib/use-load";
import { Segmented } from "../catalog/CatalogPage";

const fmt = (n: number) => n.toLocaleString("ru-RU");

/**
 * История цены предмета или модели: медиана предложений по дням
 * на сервере объявления (или средняя по всем серверам) и полоса «от–до».
 */
export function PriceHistoryCard({ listing }: { listing: ListingDetailDto }) {
  const item = listing.catalogItem;
  const [days, setDays] = useState<PriceHistoryDays>(90);
  const [allServers, setAllServers] = useState(false);
  const { data, error, loading } = useLoad(
    () => (item ? api.priceHistory(item.id, { days, ...(allServers ? {} : { server: listing.server.number }) }) : Promise.resolve(null)),
    [item?.id, days, allServers, listing.server.number],
  );
  if (!item) return null;

  const today = mskToday();
  const series = data
    ? fillDays(daysBefore(today, data.days - 1), today, data.history).map(({ date, row }) => ({
        date,
        value: row ? (row.median ?? row.average) : null,
        low: row?.min ?? null,
        high: row?.max ?? null,
        note: row ? `предложений: ${row.offers}` : undefined,
      }))
    : [];
  const hasHistory = (data?.history.length ?? 0) > 0;
  const measure = allServers ? "средняя" : "медиана";

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 font-display text-[19px] font-bold">История цены</h2>
        <div className="flex flex-wrap gap-2">
          <Segmented
            label="Серверы"
            value={allServers ? "all" : "one"}
            options={[
              ["one", listing.server.name],
              ["all", "Все серверы"],
            ]}
            onChange={(v) => setAllServers(v === "all")}
          />
          <Segmented
            label="Период"
            value={String(days)}
            options={PRICE_HISTORY_DAYS.map((d) => [String(d), d === 365 ? "год" : `${d} дн.`])}
            onChange={(v) => setDays(Number(v) as PriceHistoryDays)}
          />
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {!data && loading && <p className="m-0 text-sm text-muted">Загружаю…</p>}
      {data && (
        <div className={`flex flex-col gap-4 ${loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
            <Stat label={`Сейчас, ${allServers ? "средняя" : "медиана"}`} value={data.current ? formatPriceShort(allServers ? data.current.average : data.current.median) : "—"} />
            <Stat label="Предложений о продаже" value={data.current ? fmt(data.current.count) : "0"} />
            <Stat label="Разброс сейчас" value={data.current ? `${formatPriceShort(data.current.min)} – ${formatPriceShort(data.current.max)}` : "—"} />
            <Stat label="Сделок за период" value={fmt(data.deals.count)} note={data.deals.average !== null ? `в среднем ${formatPriceShort(data.deals.average)}` : undefined} />
          </div>

          {hasHistory ? (
            <TimeChart
              kind="line"
              label={`Цена «${data.item.name}» по дням: ${measure}, полоса — от минимальной до максимальной`}
              points={series}
              format={formatPriceShort}
              height={190}
            />
          ) : (
            <p className="m-0 rounded-xl bg-surface-2 px-3.5 py-3 text-sm text-ink-2">
              Истории пока нет: цены записываются раз в час, график появится, когда накопятся данные.
            </p>
          )}
          <p className="m-0 text-[13px] text-faint">
            По предложениям о продаже {allServers ? "на всех серверах" : `на сервере ${listing.server.name}`}: линия — {measure} цена за день,
            полоса — от самой низкой до самой высокой. Цены указывают продавцы, площадка их не проверяет.
          </p>

          {data.deals.recent.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="m-0 text-sm font-extrabold">Последние сделки</h3>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {data.deals.recent.slice(0, 5).map((d, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                    <span className="flex items-center gap-1.5 text-ink-2">
                      <ServerDot color={d.server.color} />
                      {d.server.name} · {dayLabel(d.date.slice(0, 10))}
                      {d.operation === "buy" ? " · скупка" : ""}
                    </span>
                    <span className="font-mono font-bold tabular">{formatPriceShort(d.price)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-surface-2 px-3.5 py-2.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="font-mono text-[17px] font-bold tabular">{value}</span>
      {note && <span className="text-xs text-ink-2">{note}</span>}
    </div>
  );
}

/** Статистика своего объявления: просмотры по дням, интерес покупателей, место по цене. */
export function OwnerStatsCard({ listing }: { listing: ListingDetailDto }) {
  const { data, error } = useLoad(() => api.listingStats(listing.id), [listing.id]);
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="m-0 font-display text-[19px] font-bold">Статистика объявления</h2>
      {error && <Alert>{error}</Alert>}
      {!data && !error && <p className="m-0 text-sm text-muted">Загружаю…</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label="Просмотров всего" value={fmt(data.views)} note={`сегодня ${fmt(data.viewsToday)}`} />
            <Stat label="В избранном" value={fmt(data.favorites)} />
            <Stat label="Написали вам" value={fmt(data.conversations)} />
            <Stat label="Сделок" value={fmt(data.deals)} />
          </div>
          <TimeChart
            kind="bar"
            height={140}
            label="Просмотры объявления по дням за 30 дней"
            points={data.viewsByDay.map((d) => ({ date: d.date, value: d.value }))}
          />
          {data.position && (
            <p className="m-0 rounded-xl bg-surface-2 px-3.5 py-3 text-sm leading-snug text-ink-2">
              {data.position.rank === 1
                ? `Ваша цена самая низкая из ${data.position.total} предложений на сервере.`
                : `Ваша цена — ${data.position.rank}-я из ${data.position.total} по возрастанию. Дешевле всего: ${formatPriceShort(data.position.min)}, медиана: ${formatPriceShort(data.position.median)}.`}
            </p>
          )}
          <p className="m-0 text-[13px] text-faint">Свои просмотры не считаются. Статистику видите только вы.</p>
        </>
      )}
    </Card>
  );
}

/** Похожие предложения других игроков. */
export function SimilarListings({ listingId }: { listingId: string }) {
  const { data, setData } = useLoad(() => api.similarListings(listingId), [listingId]);
  const toggleFavorite = useFavoriteToggle(
    useCallback(
      (id: string, favorite: boolean) => {
        setData((d) => (d ? { items: d.items.map((i: ListingCardDto) => (i.id === id ? { ...i, favorite } : i)) } : d));
      },
      [setData],
    ),
  );
  if (!data || data.items.length === 0) return null;
  return (
    <section aria-labelledby="similar-title" className="flex flex-col gap-4">
      <h2 id="similar-title" className="m-0 font-display text-[22px] font-bold">
        Похожие предложения
      </h2>
      <ListingGrid items={data.items} onToggleFavorite={toggleFavorite} />
    </section>
  );
}
