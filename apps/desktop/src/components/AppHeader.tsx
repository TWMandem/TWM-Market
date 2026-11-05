import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { useAuth } from "../lib/auth-context";
import { useUpdates } from "../lib/updates-context";
import { Icon, type IconName } from "./Icon";
import { Badge, NotificationsMenu } from "./NotificationsMenu";
import { ServerSwitcher } from "./ServerSwitcher";
import { ThemePicker } from "./ThemePicker";
import { Pumpkin } from "./Halloween";
import { useSeason } from "../lib/season";

const NAV = [
  { to: "/items", label: "Предметы" },
  { to: "/cars", label: "Авторынок" },
  { to: "/notary", label: "Нотариус" },
];

/**
 * Шапка: разделы, поиск (Ctrl+K), сервер, сообщения, уведомления и меню
 * аккаунта. Редкие пункты (избранное, подписки, админ-панель) — в меню,
 * чтобы шапка помещалась в одну строку в окне стандартной ширины.
 */
export function AppHeader() {
  const { status, user } = useAuth();
  const { active: season } = useSeason();
  const { unreadMessages } = useUpdates();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // Ctrl+K (или «/» вне полей ввода) — к поиску из любого места.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-line-soft bg-ground/90 pt-[var(--safe-top,0px)] backdrop-blur-md">
      <div className="mx-auto flex max-w-[1280px] items-center gap-2.5 px-6 py-3 max-md:flex-wrap max-md:gap-2 max-md:px-4 max-md:py-2.5">
        <NavLink to="/" className="flex shrink-0 items-center gap-2.5 text-ink no-underline">
          <span
            aria-hidden="true"
            className="relative flex size-9 items-center justify-center rounded-[10px] bg-accent font-display text-[13px] font-bold text-on-accent"
          >
            TW
            {season === "halloween" && <Pumpkin lit className="absolute -bottom-2 -right-2.5 size-[22px] drop-shadow" />}
          </span>
          <span className="font-display text-[17px] font-bold max-[1100px]:sr-only">TWM Market</span>
        </NavLink>

        <nav aria-label="Разделы" className="flex shrink-0 gap-1 max-md:hidden">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-[10px] px-3 py-2.5 text-[15px] no-underline transition-colors ${
                  isActive ? "bg-surface-2 font-bold text-ink" : "font-semibold text-ink-2 hover:text-ink"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const q = search.trim();
            if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
            input.current?.blur();
          }}
          className="group flex h-11 min-w-[150px] flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3 transition-colors focus-within:border-accent max-md:order-last max-md:basis-full"
        >
          <Icon name="search" size={18} className="shrink-0 text-muted" />
          <label htmlFor="global-search" className="sr-only">
            Поиск по площадке
          </label>
          <input
            ref={input}
            id="global-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && input.current?.blur()}
            placeholder="Предмет, авто или ник"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
          />
          <kbd
            aria-hidden="true"
            className="hidden shrink-0 rounded-md border border-line px-1.5 py-0.5 font-sans text-[11px] font-bold text-faint min-[1180px]:block group-focus-within:hidden"
          >
            Ctrl K
          </kbd>
        </form>

        <div className="max-md:ml-auto">
          <ServerSwitcher />
        </div>

        {status === "authed" && (
          <Link
            to="/chats"
            aria-label={unreadMessages > 0 ? `Сообщения: ${unreadMessages} непрочитанных` : "Сообщения"}
            title="Сообщения"
            className="relative flex size-11 shrink-0 items-center justify-center rounded-xl text-ink-2 hover:bg-surface-2 hover:text-ink max-md:hidden"
          >
            <Icon name="chat" />
            {unreadMessages > 0 && <Badge count={unreadMessages} />}
          </Link>
        )}

        {status === "authed" && <NotificationsMenu />}

        {status === "authed" && user ? (
          <AccountMenu />
        ) : (
          <Link
            to="/login"
            className="flex h-11 shrink-0 items-center rounded-xl border border-line px-4 font-bold text-ink no-underline hover:border-faint"
          >
            Войти
          </Link>
        )}

        <button
          type="button"
          onClick={() => navigate(status === "authed" ? "/listings/new" : "/login", { state: { from: "/listings/new" } })}
          className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-accent px-4.5 font-extrabold text-on-accent transition-colors hover:bg-accent-soft max-md:hidden"
        >
          <Icon name="plus" size={18} strokeWidth={2.6} />
          <span className="max-[1020px]:sr-only">Разместить</span>
        </button>
      </div>
    </header>
  );
}

interface MenuItem {
  to: string;
  label: string;
  icon: IconName;
}

/** Аватар: меню со всеми личными разделами. */
function AccountMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLAnchorElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;
  const staff = user.role !== "user";
  const items: MenuItem[] = [
    { to: "/my/listings", label: "Мои объявления", icon: "list" },
    { to: "/favorites", label: "Избранное", icon: "heart" },
    { to: "/my/searches", label: "Подписки на поиск", icon: "bookmark" },
    { to: "/account", label: "Личный кабинет", icon: "user" },
    ...(staff ? [{ to: "/admin", label: "Админ-панель", icon: "shield" as const }] : []),
  ];

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Аккаунт ${user.login}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-11 items-center gap-1.5 rounded-xl px-1.5 transition-colors hover:bg-surface-2 ${open ? "bg-surface-2" : ""}`}
      >
        <span
          aria-hidden="true"
          className={`flex size-8 items-center justify-center rounded-full text-xs font-extrabold uppercase ${staff ? "bg-exchange/20 text-exchange" : "bg-line text-ink"}`}
        >
          {user.login.slice(0, 2)}
        </span>
        <Icon name="chevronDown" size={16} className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Аккаунт"
          className="menu-pop absolute right-0 top-12 z-40 flex w-[260px] flex-col overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-2xl"
        >
          <div className="flex flex-col px-3 pb-2.5 pt-2">
            <span className="truncate font-bold">{user.login}</span>
            <span className="truncate text-[13px] text-muted">{user.email}</span>
          </div>
          <div className="mb-1 border-t border-line-soft" />
          {items.map((item, i) => (
            <Link
              key={item.to}
              ref={i === 0 ? first : undefined}
              role="menuitem"
              to={item.to}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold text-ink-2 no-underline outline-none hover:bg-surface-2 hover:text-ink focus-visible:bg-surface-2 focus-visible:text-ink"
            >
              <Icon name={item.icon} size={18} className="text-muted" />
              {item.label}
            </Link>
          ))}
          <div className="my-1 border-t border-line-soft" />
          <div className="flex items-center justify-between gap-3 px-3 py-1.5">
            <span className="text-[13px] font-semibold text-muted">Тема</span>
            <div className="w-[132px]">
              <ThemePicker compact />
            </div>
          </div>
          <div className="my-1 border-t border-line-soft" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void signOut().then(() => navigate("/"));
            }}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-semibold text-ink-2 outline-none hover:bg-surface-2 hover:text-ink focus-visible:bg-surface-2"
          >
            <Icon name="logout" size={18} className="text-muted" />
            Выйти
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Нижняя панель на телефоне: главное — под большим пальцем.
 * На компьютере (окно шире 768 px) не показывается.
 */
export function BottomTabs() {
  const { status } = useAuth();
  const { unreadMessages } = useUpdates();
  const navigate = useNavigate();
  const authed = status === "authed";
  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-bold no-underline ${isActive ? "text-accent-ink" : "text-muted"}`;
  return (
    <nav
      aria-label="Основные разделы"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(4rem+var(--safe-bottom,0px))] items-stretch border-t border-line-soft bg-ground/95 pb-[var(--safe-bottom,0px)] backdrop-blur-md md:hidden"
    >
      <NavLink to="/" end className={tab}>
        <Icon name="box" size={22} />
        Главная
      </NavLink>
      <NavLink to="/items" className={tab}>
        <Icon name="search" size={22} />
        Каталог
      </NavLink>
      <button
        type="button"
        aria-label="Разместить объявление"
        onClick={() => navigate(authed ? "/listings/new" : "/login", { state: { from: "/listings/new" } })}
        className="flex flex-1 items-center justify-center"
      >
        <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-on-accent shadow-lg">
          <Icon name="plus" size={24} strokeWidth={2.6} />
        </span>
      </button>
      <NavLink to={authed ? "/chats" : "/login"} className={tab}>
        <span className="relative">
          <Icon name="chat" size={22} />
          {unreadMessages > 0 && <Badge count={unreadMessages} />}
        </span>
        Сообщения
      </NavLink>
      <NavLink to={authed ? "/favorites" : "/login"} className={tab}>
        <Icon name="heart" size={22} />
        Избранное
      </NavLink>
    </nav>
  );
}
