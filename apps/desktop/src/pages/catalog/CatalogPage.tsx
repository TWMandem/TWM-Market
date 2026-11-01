import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import {
  LISTING_SORT_LABELS,
  LISTING_SORTS,
  OPERATION_LABELS,
  formatPrice,
  parsePrice,
  type AttributeDefinitionDto,
  type ListingSearchResultDto,
  type Operation,
  type SectionCode,
} from "@twm/shared";
import { ListingGrid } from "../../components/listing";
import { Alert, Button } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useAttributes, useCatalog, useFavoriteToggle } from "../../lib/catalog";
import { useServers } from "../../lib/server-context";

const TITLES: Record<SectionCode | "search", string> = {
  items: "Рынок предметов",
  cars: "Авторынок",
  notary: "Нотариальная контора",
  search: "Поиск",
};

const OPERATIONS_BY_SECTION: Record<SectionCode | "search", Array<Operation | "">> = {
  items: ["sell", "buy", ""],
  cars: ["sell", "buy", "exchange", ""],
  notary: ["sell", "exchange", ""],
  search: ["sell", "buy", "exchange", ""],
};

/**
 * Каталог раздела: фильтры слева, карточки справа.
 * Все фильтры живут в адресе (#/items?category=3&priceMax=…) — так работают
 * кнопки «назад» и «вперёд», а поиск можно сохранить.
 */
export function CatalogPage({ section }: { section: SectionCode | "search" }) {
  const [params, setParams] = useSearchParams();
  const { data: catalog, error: catalogError } = useCatalog();
  const { current } = useServers();
  const [result, setResult] = useState<ListingSearchResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const get = (key: string) => params.get(key) ?? "";
  const set = useCallback(
    (changes: Record<string, string | null>, resetPage = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === "") next.delete(key);
            else next.set(key, value);
          }
          if (resetPage) next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // Тип имущества: у авторынка он один, у нотариуса выбирается плитками.
  const sectionTypes = useMemo(
    () => (catalog && section !== "search" ? catalog.listingTypes.filter((t) => t.sectionCode === section) : []),
    [catalog, section],
  );
  const typeId = section === "cars" || section === "items" ? sectionTypes[0]?.id ?? null : Number(get("type")) || null;
  const attributes = useAttributes(typeId);
  const filterable = attributes.filter((a) => a.filterable && a.dataType !== "text");

  const query = useMemo(() => {
    const q: Record<string, string | number | undefined> = {};
    params.forEach((value, key) => {
      q[key] = value;
    });
    if (section !== "search") q.section = section;
    if (typeId) q.type = typeId;
    if (current && !q.allServers) q.server = current.number;
    delete q.allServers;
    return q;
  }, [params, section, typeId, current]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .searchListings(query)
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setError(null);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof ApiError ? e.message : "Не удалось загрузить объявления"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query]);

  const toggleFavorite = useFavoriteToggle(
    useCallback((id: string, favorite: boolean) => {
      setResult((r) => (r ? { ...r, items: r.items.map((i) => (i.id === id ? { ...i, favorite } : i)) } : r));
    }, []),
  );

  const categories = catalog?.categories.filter((c) => c.sectionCode === "items" && c.parentId === null) ?? [];
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const page = Number(get("page")) || 1;
  const activeFilters = [...params.keys()].filter((k) => !["sort", "page", "q"].includes(k)).length;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Хлебные крошки" className="text-sm text-muted">
        <Link to="/" className="text-muted hover:text-ink">
          Главная
        </Link>{" "}
        / {TITLES[section]}
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-display text-[32px] font-bold">
            {section === "search" && get("q") ? `Поиск: «${get("q")}»` : TITLES[section]}
          </h1>
          <span className="text-muted">
            {result ? `${result.total.toLocaleString("ru-RU")} объявл.` : "…"}
            {current && !params.get("allServers") ? ` · сервер ${current.name}` : " · все серверы"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented
            label="Тип объявлений"
            value={get("operation")}
            options={OPERATIONS_BY_SECTION[section].map((op) => [op, op ? OPERATION_LABELS[op] : "Все"])}
            onChange={(operation) => set({ operation })}
          />
          <label className="sr-only" htmlFor="sort">
            Сортировка
          </label>
          <select
            id="sort"
            value={get("sort") || "new"}
            onChange={(e) => set({ sort: e.target.value === "new" ? null : e.target.value })}
            className="h-11 rounded-xl border border-line bg-surface px-3 text-ink"
          >
            {LISTING_SORTS.map((s) => (
              <option key={s} value={s}>
                {LISTING_SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {section === "notary" && catalog && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2.5">
          <TypeTile active={!typeId} label="Всё имущество" onClick={() => set({ type: null })} />
          {sectionTypes.map((t) => (
            <TypeTile key={t.id} active={typeId === t.id} label={t.name} onClick={() => set({ type: String(t.id) })} />
          ))}
          <Link
            to="/cars?dealPlace=notary"
            className="flex min-h-[64px] items-center rounded-2xl border border-line bg-surface px-4 text-[15px] font-bold text-ink-2 no-underline hover:border-faint"
          >
            Транспорт →
          </Link>
        </div>
      )}

      {catalogError && <Alert>{catalogError}</Alert>}

      <div className="flex flex-wrap items-start gap-6">
        <aside aria-label="Фильтры" className="flex min-w-0 flex-[1_1_250px] flex-col gap-5 rounded-[var(--radius-card)] border border-line bg-surface p-5 lg:max-w-[290px]">
          {section === "items" && (
            <FilterGroup title="КАТЕГОРИИ">
              <CategoryButton active={!get("category")} label="Все категории" onClick={() => set({ category: null, item: null })} />
              {categories.map((c) => (
                <CategoryButton
                  key={c.id}
                  active={get("category") === String(c.id)}
                  label={c.name}
                  count={c.itemsCount}
                  onClick={() => set({ category: String(c.id), item: null })}
                />
              ))}
            </FilterGroup>
          )}

          <FilterGroup title="ЦЕНА, ₽">
            <PriceRange
              min={get("priceMin")}
              max={get("priceMax")}
              onChange={(priceMin, priceMax) => set({ priceMin, priceMax })}
            />
          </FilterGroup>

          <FilterGroup title="СЕРВЕР">
            <Check
              label={current ? `Только ${current.name}` : "Сервер не выбран"}
              checked={!!current && !params.get("allServers")}
              disabled={!current}
              onChange={(on) => set({ allServers: on ? null : "1", transfer: null })}
            />
            {current && !params.get("allServers") && (
              <Check
                label="И с других серверов, если возможен перевод"
                checked={!!params.get("transfer")}
                onChange={(on) => set({ transfer: on ? "1" : null })}
              />
            )}
          </FilterGroup>

          {section === "cars" && (
            <FilterGroup title="СПОСОБ СДЕЛКИ">
              <select
                aria-label="Способ сделки"
                value={get("dealPlace")}
                onChange={(e) => set({ dealPlace: e.target.value })}
                className="h-11 rounded-xl border border-line bg-ground px-3 text-ink"
              >
                <option value="">Любой</option>
                <option value="car_market">Авторынок «Анашан»</option>
                <option value="notary">Нотариальная контора</option>
              </select>
            </FilterGroup>
          )}

          {filterable.length > 0 && (
            <FilterGroup title="ХАРАКТЕРИСТИКИ">
              {filterable.map((def) => (
                <AttributeFilter key={def.id} def={def} get={get} set={set} />
              ))}
            </FilterGroup>
          )}

          <FilterGroup title="ДАТА ПУБЛИКАЦИИ">
            <select
              aria-label="Дата публикации"
              value={get("period")}
              onChange={(e) => set({ period: e.target.value })}
              className="h-11 rounded-xl border border-line bg-ground px-3 text-ink"
            >
              <option value="">За всё время</option>
              <option value="1d">За 24 часа</option>
              <option value="7d">За неделю</option>
              <option value="30d">За месяц</option>
            </select>
          </FilterGroup>

          <FilterGroup title="НИК ПРОДАВЦА">
            <NickFilter value={get("nick")} onChange={(nick) => set({ nick })} />
          </FilterGroup>

          {activeFilters > 0 && (
            <Button
              variant="secondary"
              onClick={() => setParams(get("q") ? new URLSearchParams({ q: get("q") }) : new URLSearchParams(), { replace: true })}
            >
              Сбросить фильтры
            </Button>
          )}
        </aside>

        <section aria-label="Результаты" aria-busy={loading} className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          {error && <Alert>{error}</Alert>}
          {result && result.items.length === 0 && !loading && (
            <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line px-6 py-16 text-center">
              <h2 className="m-0 text-lg font-bold">Ничего не нашли</h2>
              <p className="m-0 max-w-md text-sm text-muted">
                Попробуйте убрать часть фильтров или посмотреть другие серверы.
              </p>
              <Link to="/listings/new" className="font-bold text-accent hover:text-accent-soft">
                Разместить своё объявление →
              </Link>
            </div>
          )}
          {result && result.items.length > 0 && <ListingGrid items={result.items} onToggleFavorite={(l) => void toggleFavorite(l)} />}
          {!result && loading && <p className="text-muted">Загружаю…</p>}

          {pages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button variant="secondary" disabled={page <= 1} onClick={() => set({ page: String(page - 1) }, false)}>
                ← Назад
              </Button>
              <span className="text-sm text-muted">
                {page} из {pages}
              </span>
              <Button variant="secondary" disabled={page >= pages} onClick={() => set({ page: String(page + 1) }, false)}>
                Вперёд →
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="m-0 text-xs font-extrabold tracking-[0.06em] text-muted">{title}</h2>
      {children}
    </div>
  );
}

function CategoryButton({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex min-h-10 items-center justify-between rounded-[10px] px-3 text-left text-[15px] font-semibold ${
        active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2"
      }`}
    >
      <span>{label}</span>
      {count !== undefined && <span className="font-mono text-xs text-faint">{count}</span>}
    </button>
  );
}

function TypeTile({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex min-h-[64px] items-center rounded-2xl border px-4 text-left text-[15px] font-bold ${
        active ? "border-exchange bg-surface-2 text-ink" : "border-line bg-surface text-ink-2 hover:border-faint"
      }`}
    >
      {label}
    </button>
  );
}

export function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-xl border border-line bg-surface p-1">
      {options.map(([v, text]) => (
        <button
          key={v || "all"}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`h-9 rounded-[9px] px-3.5 text-sm font-bold ${value === v ? "bg-line text-ink" : "text-muted hover:text-ink"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex min-h-10 items-center gap-2.5 text-sm leading-snug ${disabled ? "text-faint" : "cursor-pointer text-ink-2"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-[18px] shrink-0 accent-accent"
      />
      {label}
    </label>
  );
}

/** Поля «от» и «до» понимают «500к», «18.2кк» и полные суммы. */
function PriceRange({ min, max, onChange }: { min: string; max: string; onChange: (min: string, max: string) => void }) {
  const [from, setFrom] = useState(min ? formatPrice(Number(min)).replace(/\s?₽$/, "") : "");
  const [to, setTo] = useState(max ? formatPrice(Number(max)).replace(/\s?₽$/, "") : "");
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const a = from.trim() ? parsePrice(from) : null;
    const b = to.trim() ? parsePrice(to) : null;
    if ((from.trim() && a === null) || (to.trim() && b === null)) {
      setError("Не понимаю сумму. Пример: 500к, 2.5кк, 18 000 000");
      return;
    }
    setError(null);
    onChange(a === null ? "" : String(a), b === null ? "" : String(b));
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <input
          aria-label="Цена от"
          placeholder="от"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          onBlur={apply}
          className="h-11 min-w-0 rounded-[10px] border border-line bg-ground px-3 font-mono text-ink placeholder:font-sans placeholder:text-faint"
        />
        <input
          aria-label="Цена до"
          placeholder="до"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onBlur={apply}
          className="h-11 min-w-0 rounded-[10px] border border-line bg-ground px-3 font-mono text-ink placeholder:font-sans placeholder:text-faint"
        />
      </div>
      {error && <span className="text-[13px] text-danger">{error}</span>}
    </form>
  );
}

function NickFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onChange(text.trim());
      }}
    >
      <input
        aria-label="Ник продавца"
        placeholder="Например, Ivan_Petrov"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(text.trim())}
        className="h-11 w-full rounded-[10px] border border-line bg-ground px-3 text-ink placeholder:text-faint"
      />
    </form>
  );
}

function AttributeFilter({
  def,
  get,
  set,
}: {
  def: AttributeDefinitionDto;
  get: (key: string) => string;
  set: (changes: Record<string, string | null>) => void;
}) {
  const key = `a.${def.key}`;
  if (def.dataType === "number") {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-ink-2">
          {def.label}
          {def.unit ? `, ${def.unit}` : ""}
        </span>
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label={`${def.label} от`} value={get(`${key}.min`)} onCommit={(v) => set({ [`${key}.min`]: v })} />
          <NumberInput label={`${def.label} до`} value={get(`${key}.max`)} onCommit={(v) => set({ [`${key}.max`]: v })} />
        </div>
      </div>
    );
  }
  const options: Array<[string, string]> =
    def.dataType === "boolean" ? [["true", "Да"], ["false", "Нет"]] : def.options.map((o) => [o, o]);
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-ink-2">{def.label}</span>
      <select
        value={get(key)}
        onChange={(e) => set({ [key]: e.target.value })}
        className="h-11 rounded-[10px] border border-line bg-ground px-3 text-ink"
      >
        <option value="">Любой</option>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberInput({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => onCommit(text.trim() && Number.isFinite(Number(text.replace(",", "."))) ? text.replace(",", ".") : "");
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      placeholder={label.endsWith("от") ? "от" : "до"}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className="h-11 min-w-0 rounded-[10px] border border-line bg-ground px-3 font-mono text-ink placeholder:font-sans placeholder:text-faint"
    />
  );
}
