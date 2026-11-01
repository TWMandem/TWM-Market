import { NavLink } from "react-router";
import { Icon } from "./Icon";
import { ServerSwitcher } from "./ServerSwitcher";

const NAV = [
  { to: "/items", label: "Предметы" },
  { to: "/cars", label: "Авторынок" },
  { to: "/notary", label: "Нотариус" },
];

export function AppHeader() {
  return (
    <header className="border-b border-line-soft bg-ground">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-4 px-6 py-3">
        <NavLink to="/" className="flex items-center gap-2.5 text-ink no-underline">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-[10px] bg-accent font-display text-[13px] font-bold text-on-accent"
          >
            TW
          </span>
          <span className="font-display text-[17px] font-bold">TWM Market</span>
        </NavLink>

        <nav aria-label="Разделы" className="flex flex-wrap gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-[10px] px-3 py-2.5 text-[15px] no-underline ${
                  isActive ? "bg-surface-2 font-bold text-ink" : "font-semibold text-ink-2 hover:text-ink"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex h-11 min-w-[200px] flex-[1_1_220px] items-center gap-2 rounded-xl border border-line bg-surface px-3">
          <Icon name="search" size={18} className="text-muted" />
          <label htmlFor="global-search" className="sr-only">
            Поиск по площадке
          </label>
          <input
            id="global-search"
            type="search"
            placeholder="Предмет, авто или ник продавца"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
          />
        </div>

        <ServerSwitcher />

        <div className="flex gap-1">
          <HeaderIconButton icon="heart" label="Избранное" />
          <HeaderIconButton icon="chat" label="Сообщения" />
          <HeaderIconButton icon="bell" label="Уведомления" />
        </div>

        <button
          type="button"
          className="flex h-11 items-center gap-2 rounded-xl bg-accent px-4.5 font-extrabold text-on-accent hover:bg-accent-soft"
        >
          <Icon name="plus" size={18} strokeWidth={2.6} />
          Разместить
        </button>
      </div>
    </header>
  );
}

function HeaderIconButton({ icon, label }: { icon: "heart" | "chat" | "bell"; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex size-11 items-center justify-center rounded-xl text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      <Icon name={icon} />
    </button>
  );
}
