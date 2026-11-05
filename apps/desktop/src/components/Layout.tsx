import { useEffect } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../lib/auth-context";
import { installDeepLinks } from "../lib/deep-link";
import { AppHeader, BottomTabs } from "./AppHeader";
import { ConnectionStatus } from "./ConnectionStatus";
import { ErrorBoundary } from "./ErrorBoundary";
import { UpdateBanner, VersionInfo } from "./UpdateBanner";
import { WelcomeDialog } from "./WelcomeDialog";

export function Layout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const showVerifyBanner = user && !user.emailVerified && pathname !== "/verify-email";
  const navigate = useNavigate();

  // Ссылки «Открыть в приложении» с сайта (twm-market://listing/ID).
  useEffect(() => {
    void installDeepLinks((path) => navigate(path)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <WelcomeDialog />
      <UpdateBanner />
      {showVerifyBanner && (
        <div className="border-b border-warn-line bg-warn-bg">
          <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-3 px-4 py-2.5 text-sm text-warn-ink md:px-6">
            <span>Подтвердите email — без этого нельзя будет публиковать объявления.</span>
            <Link to="/verify-email" className="font-bold text-accent-ink hover:text-accent-soft">
              Ввести код →
            </Link>
          </div>
        </div>
      )}
      <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-24 pt-5 md:px-6 md:pb-16 md:pt-10">
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <footer className="border-t border-line-soft max-md:mb-16">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-4 py-4 text-[13px] text-muted md:px-6">
          <span>TWM Market — неофициальная площадка игроков. Не связана с разработчиками Amazing Online.</span>
          <span className="flex flex-wrap items-center gap-4">
            <VersionInfo />
            <ConnectionStatus />
          </span>
        </div>
      </footer>
      <BottomTabs />
    </div>
  );
}
