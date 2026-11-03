import { Link, useLocation } from "react-router";
import { Alert, Button, Card } from "../../components/ui";
import { useAuth } from "../../lib/auth-context";
import { ChatSettingsSection } from "./ChatSettingsSection";
import { GameProfilesSection } from "./GameProfilesSection";
import { SecuritySection } from "./SecuritySection";

const ROLE_LABELS = { user: "Игрок", moderator: "Модератор", admin: "Администратор", superadmin: "Суперадминистратор" };

export function AccountPage() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;

  if (!user) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-14 items-center justify-center rounded-full bg-line font-display text-lg font-bold uppercase"
          >
            {user.login.slice(0, 2)}
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="m-0 font-display text-[28px] font-bold">{user.login}</h1>
            <span className="text-sm text-muted">
              {ROLE_LABELS[user.role]} · на площадке с {new Date(user.createdAt).toLocaleDateString("ru-RU")}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/my/listings" className="flex h-11 items-center rounded-xl bg-accent px-4 font-extrabold text-on-accent no-underline hover:bg-accent-soft">
            Мои объявления
          </Link>
          <Link to="/favorites" className="flex h-11 items-center rounded-xl border border-line px-4 font-bold text-ink no-underline hover:border-faint">
            Избранное
          </Link>
          <Link to="/my/searches" className="flex h-11 items-center rounded-xl border border-line px-4 font-bold text-ink no-underline hover:border-faint">
            Подписки на поиск
          </Link>
          <Button variant="secondary" onClick={() => void signOut()}>
            Выйти
          </Button>
        </div>
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}

      <Card className="flex flex-col gap-3">
        <h2 className="m-0 text-[17px] font-extrabold">Аккаунт</h2>
        <dl className="m-0 grid grid-cols-[minmax(0,160px)_1fr] gap-x-6 gap-y-3 text-[15px]">
          <dt className="text-muted">Логин</dt>
          <dd className="m-0 font-semibold">{user.login}</dd>
          <dt className="text-muted">Email</dt>
          <dd className="m-0 flex flex-wrap items-center gap-2 font-semibold">
            {user.email}
            {user.emailVerified ? (
              <span className="rounded-md bg-[#4cd48a]/15 px-2 py-0.5 text-xs font-bold text-success">подтверждён</span>
            ) : (
              <Link
                to="/verify-email"
                className="rounded-md bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent-soft hover:text-accent"
              >
                подтвердить →
              </Link>
            )}
          </dd>
        </dl>
        <p className="m-0 text-[13px] text-faint">Email не виден другим пользователям.</p>
      </Card>

      <GameProfilesSection />
      <ChatSettingsSection />
      <SecuritySection />
    </div>
  );
}
