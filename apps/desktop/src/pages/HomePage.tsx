import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { ListingCardDto } from "@twm/shared";
import { ListingGrid } from "../components/listing";
import { api } from "../lib/api";
import { useFavoriteToggle } from "../lib/catalog";
import { Icon } from "../components/Icon";
import { useServers } from "../lib/server-context";
import { SECTIONS } from "./sections";

export function HomePage() {
  const { current } = useServers();
  const [fresh, setFresh] = useState<ListingCardDto[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .searchListings({ server: current?.number, sort: "new" })
      .then((r) => !cancelled && setFresh(r.items.slice(0, 8)))
      .catch(() => !cancelled && setFresh([]));
    return () => {
      cancelled = true;
    };
  }, [current]);

  const toggle = useFavoriteToggle(
    useCallback((id: string, favorite: boolean) => {
      setFresh((list) => list?.map((i) => (i.id === id ? { ...i, favorite } : i)) ?? list);
    }, []),
  );

  return (
    <div className="flex flex-col gap-14">
      <section className="flex max-w-[760px] flex-col gap-5">
        <span className="self-start rounded-full border border-line px-3 py-1.5 text-[13px] font-bold text-muted">
          Неофициальная площадка игроков
        </span>
        <h1 className="m-0 font-display text-[clamp(32px,4.4vw,52px)] font-bold leading-[1.08] tracking-tight">
          Рынок, авторынок и нотариус — <span className="text-accent">в одном поиске</span>
        </h1>
        <p className="m-0 text-lg leading-relaxed text-ink-2">
          Находите предметы, автомобили и имущество
          {current ? (
            <>
              {" "}
              на сервере <strong className="text-ink">{current.name}</strong>
            </>
          ) : (
            " на своём сервере"
          )}
          , сравнивайте цены и договаривайтесь с продавцами. Сама сделка проходит в игре.
        </p>
      </section>

      <section aria-labelledby="sections-title" className="flex flex-col gap-5">
        <h2 id="sections-title" className="m-0 font-display text-[22px] font-bold">
          Разделы
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
          {SECTIONS.map((section) => (
            <Link
              key={section.key}
              to={section.path}
              className="flex flex-col gap-3.5 rounded-[var(--radius-card)] border border-line bg-surface p-6 text-ink no-underline transition-colors hover:border-faint"
            >
              <span className={`flex size-12 items-center justify-center rounded-[14px] ${section.toneBg} ${section.tone}`}>
                <Icon name={section.icon} size={24} />
              </span>
              <span className="font-display text-lg font-bold">{section.title}</span>
              <span className="text-sm leading-relaxed text-muted">{section.description}</span>
              <span className={`mt-auto font-extrabold ${section.tone}`}>Открыть →</span>
            </Link>
          ))}
        </div>
      </section>

      {fresh && fresh.length > 0 && (
        <section aria-labelledby="fresh-title" className="flex flex-col gap-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="fresh-title" className="m-0 font-display text-[22px] font-bold">
              Новое{current ? ` на ${current.name}` : ""}
            </h2>
            <Link to="/search?sort=new" className="font-bold text-accent hover:text-accent-soft">
              Все объявления →
            </Link>
          </div>
          <ListingGrid items={fresh} onToggleFavorite={(l) => void toggle(l)} />
        </section>
      )}

      <section
        aria-labelledby="safety-title"
        className="flex max-w-[760px] flex-col gap-3.5 rounded-[var(--radius-card)] border border-[#3a3220] bg-[#17140d] p-6"
      >
        <div className="flex items-center gap-2.5 text-accent">
          <Icon name="shield" size={24} />
          <h2 id="safety-title" className="m-0 font-display text-[17px] font-bold text-ink">
            Безопасная сделка
          </h2>
        </div>
        <p className="m-0 text-sm leading-relaxed text-[#d6cdb8]">
          Площадка помогает найти друг друга, но не участвует в сделке и не гарантирует передачу имущества — она
          проходит в игре.
        </p>
        <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-[#d6cdb8]">
          <li>Сверьте ник собеседника в игре с ником из чата площадки.</li>
          <li>Смотрите на профиль продавца: возраст аккаунта, отзывы, сделки.</li>
          <li>Торговля за реальные деньги запрещена правилами площадки.</li>
        </ul>
      </section>
    </div>
  );
}
