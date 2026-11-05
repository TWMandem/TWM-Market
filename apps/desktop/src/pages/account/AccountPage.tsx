import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { Icon } from "../../components/Icon";
import { ThemePicker } from "../../components/ThemePicker";
import { Alert, Card } from "../../components/ui";
import { useAuth } from "../../lib/auth-context";
import { ChatSettingsSection } from "./ChatSettingsSection";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { GameProfilesSection } from "./GameProfilesSection";
import { NotificationsSection } from "./NotificationsSection";
import { SecuritySection } from "./SecuritySection";

const ROLE_LABELS = { user: "Игрок", moderator: "Модератор", admin: "Администратор", superadmin: "Суперадминистратор" };

/** Разделы страницы — для меню слева. Порядок как на странице. */
const SECTIONS = [
  { id: "account", label: "Аккаунт" },
  { id: "profiles", label: "Игровые профили" },
  { id: "privacy", label: "Приватность" },
  { id: "notifications", label: "Уведомления" },
  { id: "appearance", label: "Оформление" },
  { id: "templates", label: "Шаблоны ответов" },
  { id: "blocks", label: "Чёрный список" },
  { id: "security", label: "Безопасность и входы" },
  { id: "delete", label: "Удаление аккаунта" },
];

/** Подсвечивает в меню раздел, который сейчас на экране. */
function useActiveSection(): string {
  const [active, setActive] = useState(SECTIONS[0]!.id);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-90px 0px -60% 0px" },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);
  return active;
}

export function AccountPage() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const active = useActiveSection();

  // Переход по ссылке вида /account#notifications — к нужному разделу.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (!id || !SECTIONS.some((s) => s.id === id)) return;
    const timer = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    return () => window.clearTimeout(timer);
  }, [location.hash]);

  if (!user) return null;

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-6 lg:sticky lg:top-24">
        <div className="flex items-center gap-3.5">
          <span
            aria-hidden="true"
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-line font-display text-lg font-bold uppercase"
          >
            {user.login.slice(0, 2)}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="m-0 truncate font-display text-[22px] font-bold">{user.login}</h1>
            <span className="text-[13px] leading-snug text-muted">
              {ROLE_LABELS[user.role]}, с {new Date(user.createdAt).toLocaleDateString("ru-RU")}
            </span>
          </div>
        </div>

        <nav aria-label="Разделы личного кабинета" className="flex flex-col gap-0.5 max-lg:hidden">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              aria-current={active === s.id ? "true" : undefined}
              className={`relative rounded-xl px-3.5 py-2.5 text-[15px] no-underline transition-colors ${
                active === s.id ? "bg-surface font-bold text-ink" : "font-semibold text-muted hover:text-ink"
              }`}
            >
              {active === s.id && <span aria-hidden="true" className="absolute inset-y-2.5 left-0 w-[3px] rounded-full bg-accent" />}
              {s.label}
            </a>
          ))}
        </nav>

        <div className="flex flex-col gap-0.5 border-t border-line-soft pt-4 max-lg:hidden">
          <Link to="/my/listings" className="flex items-center gap-2.5 rounded-xl px-3.5 py-2 text-[14px] font-semibold text-muted no-underline hover:text-ink">
            <Icon name="list" size={16} /> Мои объявления
          </Link>
          <Link to="/favorites" className="flex items-center gap-2.5 rounded-xl px-3.5 py-2 text-[14px] font-semibold text-muted no-underline hover:text-ink">
            <Icon name="heart" size={16} /> Избранное
          </Link>
          <Link to="/my/searches" className="flex items-center gap-2.5 rounded-xl px-3.5 py-2 text-[14px] font-semibold text-muted no-underline hover:text-ink">
            <Icon name="bookmark" size={16} /> Подписки на поиск
          </Link>
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex items-center gap-2.5 rounded-xl px-3.5 py-2 text-left text-[14px] font-semibold text-muted hover:text-ink"
          >
            <Icon name="logout" size={16} /> Выйти
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col gap-6">
        {notice && <Alert tone="success">{notice}</Alert>}

        <Card id="account" className="flex flex-col gap-3">
          <h2 className="m-0 text-[17px] font-extrabold">Аккаунт</h2>
          <dl className="m-0 grid grid-cols-[minmax(0,160px)_1fr] gap-x-6 gap-y-3 text-[15px]">
            <dt className="text-muted">Логин</dt>
            <dd className="m-0 font-semibold">{user.login}</dd>
            <dt className="text-muted">Email</dt>
            <dd className="m-0 flex flex-wrap items-center gap-2 font-semibold">
              {user.email}
              {user.emailVerified ? (
                <span className="rounded-md bg-success/15 px-2 py-0.5 text-xs font-bold text-success">подтверждён</span>
              ) : (
                <Link to="/verify-email" className="rounded-md bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent-soft hover:text-accent-ink">
                  подтвердить
                </Link>
              )}
            </dd>
          </dl>
          <p className="m-0 text-[13px] text-faint">Email не виден другим пользователям.</p>
        </Card>

        <GameProfilesSection />
        <ChatSettingsSection
          after={{
            privacy: (
              <>
                <NotificationsSection />
                <Card id="appearance" className="flex scroll-mt-24 flex-col gap-3">
                  <h2 className="m-0 text-[17px] font-extrabold">Оформление</h2>
                  <p className="m-0 text-[13px] text-muted">Тема запоминается на этом компьютере. «Как в Windows» — меняется вместе с темой системы.</p>
                  <div className="max-w-[460px]">
                    <ThemePicker />
                  </div>
                </Card>
              </>
            ),
          }}
        />
        <SecuritySection />
        <DeleteAccountSection />
      </div>
    </div>
  );
}
