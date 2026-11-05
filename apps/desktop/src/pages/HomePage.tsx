import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { formatPrice, type ConversationDto, type ListingCardDto, type SavedSearchDto } from "@twm/shared";
import { Icon, type IconName } from "../components/Icon";
import { ListingGrid, Media, ServerDot } from "../components/listing";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useFavoriteToggle } from "../lib/catalog";
import { useServers } from "../lib/server-context";
import { readSetting, writeSetting } from "../lib/storage";
import { useUpdates } from "../lib/updates-context";
import { SECTIONS, type SectionKey } from "./sections";

/**
 * Главная приложения — рабочий экран: разделы с числом объявлений,
 * «Ждёт вашего ответа» (предложения цены, сделки, непрочитанное,
 * новые по подпискам) и свежие объявления сервера.
 */
export function HomePage() {
  const { current } = useServers();
  const { status, user } = useAuth();
  const [fresh, setFresh] = useState<ListingCardDto[] | null>(null);
  const [counts, setCounts] = useState<Partial<Record<SectionKey, number>>>({});

  useEffect(() => {
    let cancelled = false;
    setFresh(null);
    api
      .searchListings({ server: current?.number, sort: "new" })
      .then((r) => !cancelled && setFresh(r.items.slice(0, 10)))
      .catch(() => !cancelled && setFresh([]));
    for (const s of SECTIONS) {
      api
        .searchListings({ section: s.key, server: current?.number })
        .then((r) => !cancelled && setCounts((c) => ({ ...c, [s.key]: r.total })))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [current]);

  const toggle = useFavoriteToggle(
    useCallback((id: string, favorite: boolean) => {
      setFresh((list) => list?.map((i) => (i.id === id ? { ...i, favorite } : i)) ?? list);
    }, []),
  );

  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="m-0 font-display text-[clamp(26px,3vw,34px)] font-bold leading-tight">
              {status === "authed" && user ? `${greeting}, ${user.login}` : "Рынок игроков Amazing Online"}
            </h1>
            <p className="m-0 text-[15px] text-muted">
              {current ? (
                <>
                  Объявления сервера <b className="text-ink-2">{current.name}</b>. Сервер меняется в шапке.
                </>
              ) : (
                "Объявления всех серверов. Выберите свой сервер в шапке, чтобы видеть только его."
              )}
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {SECTIONS.map((section) => (
            <Link
              key={section.key}
              to={section.path}
              className="group relative flex items-center gap-4 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-5 text-ink no-underline transition-colors hover:border-faint"
            >
              <span className={`flex size-12 shrink-0 items-center justify-center rounded-[14px] ${section.toneBg} ${section.tone}`}>
                <Icon name={section.icon} size={24} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-display text-[17px] font-bold">{section.title}</span>
                <span className="text-[13px] text-muted">
                  {counts[section.key] === undefined ? "…" : `${counts[section.key]!.toLocaleString("ru-RU")} ${plural(counts[section.key]!, "объявление", "объявления", "объявлений")}`}
                </span>
              </span>
              <Icon name="arrowRight" size={20} className={`shrink-0 opacity-40 transition-all group-hover:translate-x-1 group-hover:opacity-100 ${section.tone}`} />
            </Link>
          ))}
        </div>
      </section>

      <ServerPrompt />

      {status === "authed" && <Attention />}

      <section aria-labelledby="fresh-title" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="fresh-title" className="m-0 font-display text-[22px] font-bold">
            Новое{current ? ` на ${current.name}` : ""}
          </h2>
          <Link to="/search?sort=new" className="flex items-center gap-1.5 font-bold text-accent-ink no-underline hover:text-accent-soft">
            Все объявления <Icon name="arrowRight" size={16} />
          </Link>
        </div>
        {fresh === null && <SkeletonGrid />}
        {fresh?.length === 0 && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
            <p className="m-0 max-w-[420px] leading-relaxed text-muted">
              {current ? `На ${current.name} пока нет объявлений.` : "Объявлений пока нет."} Разместите первое — его увидят все игроки сервера.
            </p>
            <Link to="/listings/new" className="flex h-11 items-center gap-2 rounded-xl bg-accent px-4 font-extrabold text-on-accent no-underline hover:bg-accent-soft">
              <Icon name="plus" size={18} strokeWidth={2.6} /> Разместить
            </Link>
          </div>
        )}
        {fresh && fresh.length > 0 && <ListingGrid items={fresh} onToggleFavorite={(l) => void toggle(l)} />}
      </section>

      <section aria-label="Безопасная сделка" className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-warn-line bg-warn-bg px-5 py-4">
        <span className="flex items-center gap-2.5 text-accent-ink">
          <Icon name="shield" size={22} />
          <b className="font-display text-[15px] text-ink">Безопасная сделка</b>
        </span>
        <span className="flex-1 text-sm leading-relaxed text-warn-ink">
          Имущество передаётся только в игре. Сверьте ник собеседника и посмотрите его отзывы. Торговля за реальные деньги запрещена.
        </span>
      </section>
    </div>
  );
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

function SkeletonGrid() {
  return (
    <div aria-hidden="true" className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex animate-pulse flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="h-[150px] bg-surface-2" />
          <div className="flex flex-col gap-2.5 p-4">
            <div className="h-4 w-3/4 rounded bg-surface-2" />
            <div className="h-5 w-1/2 rounded bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface Task {
  key: string;
  icon: IconName;
  tone: string;
  title: string;
  detail: string;
  to: string;
  action: string;
  image?: ConversationDto["listing"]["image"];
}

/** Что ждёт ответа игрока: собирается из переписок и подписок. */
function Attention() {
  const { version } = useUpdates();
  const [tasks, setTasks] = useState<Task[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.conversations().catch(() => ({ items: [] as ConversationDto[] })), api.savedSearches().catch(() => ({ items: [] as SavedSearchDto[] }))]).then(
      ([chats, searches]) => {
        if (cancelled) return;
        const list: Task[] = [];
        for (const c of chats.items) {
          const who = c.counterpart.nickname ?? c.counterpart.login;
          if (c.offer && !c.offer.mine) {
            list.push({
              key: `offer-${c.id}`,
              icon: "tag",
              tone: "text-accent-ink bg-accent/15",
              title: `${who} предлагает ${formatPrice(c.offer.price)}`,
              detail: c.listing.title,
              to: `/chats/${c.id}`,
              action: "Ответить",
              image: c.listing.image,
            });
          } else if (c.deal?.status === "proposed" && !c.deal.proposedByMe) {
            list.push({
              key: `deal-${c.id}`,
              icon: "check",
              tone: "text-success bg-success/15",
              title: `${who} отметил(а) сделку — подтвердите`,
              detail: c.listing.title,
              to: `/chats/${c.id}`,
              action: "Подтвердить",
              image: c.listing.image,
            });
          } else if (c.deal?.canReview) {
            list.push({
              key: `review-${c.id}`,
              icon: "check",
              tone: "text-success bg-success/15",
              title: `Оставьте отзыв о сделке с ${who}`,
              detail: c.listing.title,
              to: `/chats/${c.id}`,
              action: "Оставить отзыв",
              image: c.listing.image,
            });
          } else if (c.unread > 0) {
            list.push({
              key: `chat-${c.id}`,
              icon: "chat",
              tone: "text-buy bg-buy/15",
              title: `${c.unread} ${plural(c.unread, "новое сообщение", "новых сообщения", "новых сообщений")} от ${who}`,
              detail: c.listing.title,
              to: `/chats/${c.id}`,
              action: "Открыть",
              image: c.listing.image,
            });
          }
        }
        for (const s of searches.items) {
          if (s.newCount > 0) {
            list.push({
              key: `search-${s.id}`,
              icon: "bookmark",
              tone: "text-exchange bg-exchange/15",
              title: `${s.newCount >= 100 ? "100+" : s.newCount} ${plural(s.newCount, "новое объявление", "новых объявления", "новых объявлений")} по подписке`,
              detail: s.name,
              to: "/my/searches",
              action: "Посмотреть",
            });
          }
        }
        setTasks(list.slice(0, 6));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (!tasks || tasks.length === 0) return null;

  return (
    <section aria-labelledby="attention-title" className="flex flex-col gap-4">
      <h2 id="attention-title" className="m-0 font-display text-[22px] font-bold">
        Ждёт вашего ответа
      </h2>
      <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2.5 p-0 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        {tasks.map((t) => (
          <li key={t.key} className="min-w-0">
            <Link
              to={t.to}
              className="group flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-3 pr-4 text-ink no-underline transition-colors hover:border-faint"
            >
              {t.image ? (
                <Media media={t.image} alt="" fit="cover" className="size-12 shrink-0 rounded-xl" />
              ) : (
                <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${t.tone}`}>
                  <Icon name={t.icon} size={22} />
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[15px] font-bold">{t.title}</span>
                <span className="truncate text-[13px] text-muted">{t.detail}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-accent-ink">
                <span className="max-sm:sr-only">{t.action}</span>
                <Icon name="arrowRight" size={16} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Сервер не выбран: предложить выбрать — каталог станет точнее. Можно скрыть. */
function ServerPrompt() {
  const { servers, current, select } = useServers();
  const [hidden, setHidden] = useState(() => readSetting("serverPrompt") === "hidden");
  if (current || hidden) return null;
  return (
    <section aria-labelledby="server-prompt-title" className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-accent/30 bg-accent/[0.06] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="server-prompt-title" className="m-0 text-[17px] font-extrabold">
            На каком сервере вы играете?
          </h2>
          <p className="m-0 text-sm text-ink-2">Каталог и новые объявления будут показывать ваш сервер. Поменять можно в шапке.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            writeSetting("serverPrompt", "hidden");
            setHidden(true);
          }}
          className="h-9 rounded-lg px-3 text-sm font-bold text-muted hover:bg-surface-2 hover:text-ink"
        >
          Смотреть все серверы
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {servers.map((s) => (
          <button
            key={s.number}
            type="button"
            onClick={() => select(s.number)}
            className="flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-bold text-ink-2 transition-colors hover:border-accent hover:text-ink"
          >
            <ServerDot color={s.color} size={9} />
            {s.name}
          </button>
        ))}
      </div>
    </section>
  );
}
