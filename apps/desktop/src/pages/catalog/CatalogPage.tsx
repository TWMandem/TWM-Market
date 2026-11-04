import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import {
  LISTING_SORT_LABELS,
  LISTING_SORTS,
  OPERATION_LABELS,
  definitionsForCategory,
  formatPrice,
  parsePrice,
  unitParts,
  type AttributeDefinitionDto,
  type CatalogItemOptionDto,
  type ListingSearchResultDto,
  type Operation,
  type SectionCode,
} from "@twm/shared";
import { Icon } from "../../components/Icon";
import { ListingGrid, ListingList } from "../../components/listing";
import { SaveSearchDialog } from "../../components/SaveSearchDialog";
import { Alert, Button } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useAttributes, useCatalog, useFavoriteToggle } from "../../lib/catalog";
import { useServers } from "../../lib/server-context";
import { readSetting, writeSetting } from "../../lib/storage";

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
  const [subscribing, setSubscribing] = useState(false);
  const { status } = useAuth();
  const [view, setViewState] = useState<"grid" | "list">(() => (readSetting("catalogView") === "list" ? "list" : "grid"));
  const setView = (v: "grid" | "list") => {
    setViewState(v);
    writeSetting("catalogView", v);
  };

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
  const categoryFilter = Number(get("category")) || null;
  const categoryPath = useMemo(() => {
    if (!categoryFilter) return null;
    const parent = catalog?.categories.find((c) => c.id === categoryFilter)?.parentId ?? null;
    return parent === null ? [categoryFilter] : [categoryFilter, parent];
  }, [catalog, categoryFilter]);
  // Поля конкретных категорий (улучшение, целостность одежды) — только когда категория выбрана.
  const filterable = definitionsForCategory(attributes, categoryPath).filter((a) => a.filterable && a.dataType !== "text");

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

  const categorySection = section === "items" || section === "cars" ? section : null;
  const categories = catalog?.categories.filter((c) => c.sectionCode === categorySection && c.parentId === null) ?? [];
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const page = Number(get("page")) || 1;
  const activeFilters = [...params.keys()].filter((k) => !["sort", "page", "q"].includes(k)).length;

  // Выбранные фильтры — плашками над результатами, каждую можно убрать.
  const chips: Array<{ label: string; clear: Record<string, null> }> = [];
  {
    const category = catalog?.categories.find((c) => c.id === categoryFilter);
    if (category) chips.push({ label: category.name, clear: { category: null, item: null } });
    if (section === "notary" && typeId) {
      const type = sectionTypes.find((t) => t.id === typeId);
      if (type) chips.push({ label: type.name, clear: { type: null } });
    }
    const op = get("operation") as Operation | "";
    if (op) chips.push({ label: OPERATION_LABELS[op], clear: { operation: null } });
    const pMin = Number(get("priceMin"));
    const pMax = Number(get("priceMax"));
    if (get("priceMin") && get("priceMax")) chips.push({ label: `${formatPrice(pMin)} – ${formatPrice(pMax)}`, clear: { priceMin: null, priceMax: null } });
    else if (get("priceMin")) chips.push({ label: `от ${formatPrice(pMin)}`, clear: { priceMin: null } });
    else if (get("priceMax")) chips.push({ label: `до ${formatPrice(pMax)}`, clear: { priceMax: null } });
    if (params.get("allServers")) chips.push({ label: "Все серверы", clear: { allServers: null } });
    if (params.get("transfer")) chips.push({ label: "С переводом с других серверов", clear: { transfer: null } });
    if (get("item")) chips.push({ label: "Модель выбрана", clear: { item: null } });
    if (get("dealPlace")) chips.push({ label: get("dealPlace") === "notary" ? "Через нотариуса" : "Через авторынок", clear: { dealPlace: null } });
    const periods: Record<string, string> = { "1d": "За 24 часа", "7d": "За неделю", "30d": "За месяц" };
    if (periods[get("period")]) chips.push({ label: periods[get("period")]!, clear: { period: null } });
    if (get("nick")) chips.push({ label: `Ник: ${get("nick")}`, clear: { nick: null } });
    for (const def of filterable) {
      const key = `a.${def.key}`;
      const min = get(`${key}.min`);
      const max = get(`${key}.max`);
      if (min || max) chips.push({ label: `${def.label}: ${min || "…"}–${max || "…"}`, clear: { [`${key}.min`]: null, [`${key}.max`]: null } });
      const v = get(key);
      if (v) chips.push({ label: `${def.label}: ${def.dataType === "boolean" ? (v === "true" ? "да" : "нет") : v}`, clear: { [key]: null } });
    }
  }

  // Подписка хранит параметры запроса к поиску (с разделом, типом и сервером).
  const subscriptionParams = () => {
    const out = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "" && key !== "page" && key !== "sort") out.set(key, String(value));
    }
    return out.toString();
  };
  const suggestedName = () => {
    const parts: string[] = [];
    const category = catalog?.categories.find((c) => c.id === categoryFilter)?.name;
    const type = section === "notary" && typeId ? sectionTypes.find((t) => t.id === typeId)?.name : undefined;
    parts.push(category ?? type ?? TITLES[section]);
    if (get("q")) parts.push(`«${get("q")}»`);
    if (get("priceMax")) parts.push(`до ${formatPrice(Number(get("priceMax")))}`);
    if (current && !params.get("allServers")) parts.push(current.name);
    return parts.join(", ");
  };

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
          {status === "authed" && (
            <Button variant="secondary" onClick={() => setSubscribing(true)}>
              <span aria-hidden="true">🔔</span> Подписаться на поиск
            </Button>
          )}
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
      {subscribing && (
        <SaveSearchDialog section={section} params={subscriptionParams()} suggestedName={suggestedName()} onClose={() => setSubscribing(false)} />
      )}

      <div className="flex flex-wrap items-start gap-6">
        <aside
          aria-label="Фильтры"
          className="flex min-w-0 flex-[1_1_250px] flex-col gap-5 rounded-[var(--radius-card)] border border-line bg-surface p-5 lg:sticky lg:top-24 lg:max-h-[calc(100vh-112px)] lg:max-w-[290px] lg:overflow-y-auto"
          style={{ scrollbarWidth: "thin" }}
        >
          {categorySection && categories.length > 0 && (
            <FilterGroup title={section === "cars" ? "Тип транспорта" : "Категории"}>
              <CategoryButton
                active={!get("category")}
                label={section === "cars" ? "Весь транспорт" : "Все категории"}
                onClick={() => set({ category: null, item: null })}
              />
              {categories.map((c) => (
                <CategoryButton
                  key={c.id}
                  active={get("category") === String(c.id)}
                  label={c.name}
                  count={result?.categoryCounts ? (result.categoryCounts[String(c.id)] ?? 0) : undefined}
                  onClick={() => set({ category: String(c.id), item: null })}
                />
              ))}
            </FilterGroup>
          )}

          <FilterGroup title="Цена, ₽">
            <PriceRange
              min={get("priceMin")}
              max={get("priceMax")}
              onChange={(priceMin, priceMax) => set({ priceMin, priceMax })}
            />
          </FilterGroup>

          <FilterGroup title="Сервер">
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
            <FilterGroup title="Модель">
              <ModelFilter categoryId={categoryFilter} value={get("item")} onChange={(item) => set({ item })} />
            </FilterGroup>
          )}

          {section === "cars" && (
            <FilterGroup title="Способ сделки">
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
            <details className="group flex flex-col gap-2" open={filterable.length <= 3 || filterable.some((d) => [...params.keys()].some((k) => k.startsWith(`a.${d.key}`)))}>
              <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] font-extrabold text-ink-2 [&::-webkit-details-marker]:hidden">
                Характеристики
                <Icon name="chevronDown" size={16} className="text-muted transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-2 flex flex-col gap-3">
                {filterable.map((def) => (
                  <AttributeFilter key={def.id} def={def} get={get} set={set} />
                ))}
              </div>
            </details>
          )}

          <FilterGroup title="Дата публикации">
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

          <FilterGroup title="Ник продавца">
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
          <div className="flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => set(chip.clear)}
                aria-label={`Убрать фильтр: ${chip.label}`}
                className="flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface pl-3.5 pr-2.5 text-sm font-semibold text-ink-2 transition-colors hover:border-faint hover:text-ink"
              >
                {chip.label}
                <span aria-hidden="true" className="text-[17px] leading-none text-muted">×</span>
              </button>
            ))}
            {chips.length > 1 && (
              <button
                type="button"
                onClick={() => setParams(get("q") ? new URLSearchParams({ q: get("q") }) : new URLSearchParams(), { replace: true })}
                className="h-9 px-2 text-sm font-bold text-accent hover:text-accent-soft"
              >
                Сбросить все
              </button>
            )}
            <div role="group" aria-label="Вид" className="ml-auto flex rounded-xl border border-line bg-surface p-1">
              {(
                [
                  ["grid", "Плиткой"],
                  ["list", "Списком"],
                ] as const
              ).map(([v, text]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={`h-8 rounded-[9px] px-3 text-[13px] font-bold transition-colors ${view === v ? "bg-line text-ink" : "text-muted hover:text-ink"}`}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
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
          {result && result.items.length > 0 && (
            <div className={`transition-opacity ${loading ? "opacity-50" : ""}`}>
              {view === "list" ? (
                <ListingList items={result.items} onToggleFavorite={(l) => void toggleFavorite(l)} />
              ) : (
                <ListingGrid items={result.items} onToggleFavorite={(l) => void toggleFavorite(l)} />
              )}
            </div>
          )}
          {!result && loading && (
            <div aria-hidden="true" className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex animate-pulse flex-col overflow-hidden rounded-[18px] border border-line bg-surface">
                  <div className="h-[150px] bg-surface-2" />
                  <div className="flex flex-col gap-2.5 p-4">
                    <div className="h-4 w-3/4 rounded bg-surface-2" />
                    <div className="h-5 w-1/2 rounded bg-surface-2" />
                  </div>
                </div>
              ))}
            </div>
          )}

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
      <h2 className="m-0 text-[13px] font-extrabold text-ink-2">{title}</h2>
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
      className={`flex min-h-10 items-center justify-between gap-2 rounded-[10px] px-3 text-left text-[15px] font-semibold transition-colors ${
        active ? "bg-surface-2 text-ink" : count === 0 ? "text-faint hover:bg-surface-2 hover:text-ink-2" : "text-ink-2 hover:bg-surface-2"
      }`}
    >
      <span>{label}</span>
      {count !== undefined && count > 0 && <span className="font-mono text-xs text-muted">{count}</span>}
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
          {unitLabel(def.unit)}
        </span>
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label={`${def.label} от`} value={get(`${key}.min`)} onCommit={(v) => set({ [`${key}.min`]: v })} />
          <NumberInput label={`${def.label} до`} value={get(`${key}.max`)} onCommit={(v) => set({ [`${key}.max`]: v })} />
        </div>
      </div>
    );
  }
  if (def.dataType === "genes") {
    return (
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-ink-2">{def.label}: не меньше генов</span>
        <GenesInput value={get(key)} letters={def.options} onCommit={(v) => set({ [key]: v })} />
      </label>
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

/** Подпись единицы в фильтре: «, %» или «(X…)» для шаблона вроде «X{}». */
function unitLabel(unit: string | null): string {
  if (!unit) return "";
  const { prefix, suffix } = unitParts(unit);
  return unit.includes("{}") ? ` (${prefix}…${suffix})` : `, ${unit}`;
}

/** Выбор модели транспорта из справочника (с учётом выбранного типа транспорта). */
function ModelFilter({ categoryId, value, onChange }: { categoryId: number | null; value: string; onChange: (v: string) => void }) {
  const [items, setItems] = useState<CatalogItemOptionDto[]>([]);
  useEffect(() => {
    let cancelled = false;
    api
      .catalogItems(categoryId ? { categoryId } : { section: "cars" })
      .then((r) => !cancelled && setItems(r.items))
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [categoryId]);
  return (
    <select
      aria-label="Модель"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 w-full rounded-xl border border-line bg-ground px-3 text-ink"
    >
      <option value="">Любая</option>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </select>
  );
}

/** Фильтр по генам: «YYYG» — хотя бы три Y и одна G. */
function GenesInput({ value, letters, onCommit }: { value: string; letters: string[]; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const allowed = new Set(letters);
  const commit = () => onCommit([...text.toUpperCase()].filter((ch) => allowed.has(ch)).join(""));
  return (
    <input
      placeholder={`например ${letters[0] ?? ""}${letters[0] ?? ""}${letters[1] ?? ""}`}
      value={text}
      onChange={(e) => setText(e.target.value.toUpperCase())}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className="h-11 min-w-0 rounded-[10px] border border-line bg-ground px-3 font-mono tracking-[0.2em] text-ink placeholder:font-sans placeholder:tracking-normal placeholder:text-faint"
    />
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
