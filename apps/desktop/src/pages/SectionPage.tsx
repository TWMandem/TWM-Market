import { Link } from "react-router";
import { Icon } from "../components/Icon";
import { useServers } from "../lib/server-context";
import { getSection, type SectionKey } from "./sections";

/** Временная страница раздела: каталоги появятся на шаге 4. */
export function SectionPage({ section: key }: { section: SectionKey }) {
  const section = getSection(key);
  const { current } = useServers();

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Хлебные крошки" className="text-sm text-muted">
        <Link to="/" className="text-muted hover:text-ink">
          Главная
        </Link>{" "}
        / {section.title}
      </nav>
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 font-display text-[32px] font-bold">{section.title}</h1>
        <span className="text-muted">{current ? `Сервер ${current.name}` : "Все серверы"}</span>
      </div>

      <div className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] border border-dashed border-line px-6 py-20 text-center">
        <span className={`flex size-14 items-center justify-center rounded-2xl ${section.toneBg} ${section.tone}`}>
          <Icon name={section.icon} size={28} />
        </span>
        <h2 className="m-0 text-lg font-bold">Каталог в разработке</h2>
        <p className="m-0 max-w-md text-sm leading-relaxed text-muted">{section.description}</p>
      </div>
    </div>
  );
}
