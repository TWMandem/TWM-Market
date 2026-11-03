import { Link, Outlet, useLocation } from "react-router";
import { useAuth } from "../lib/auth-context";
import { AppHeader } from "./AppHeader";
import { ConnectionStatus } from "./ConnectionStatus";
import { UpdateBanner, VersionInfo } from "./UpdateBanner";

export function Layout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const showVerifyBanner = user && !user.emailVerified && pathname !== "/verify-email";

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <UpdateBanner />
      {showVerifyBanner && (
        <div className="border-b border-[#3a3220] bg-[#17140d]">
          <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-3 px-6 py-2.5 text-sm text-[#e8d3a6]">
            <span>Подтвердите email — без этого нельзя будет публиковать объявления.</span>
            <Link to="/verify-email" className="font-bold text-accent hover:text-accent-soft">
              Ввести код →
            </Link>
          </div>
        </div>
      )}
      <main className="mx-auto w-full max-w-[1280px] flex-1 px-6 pb-16 pt-10">
        <Outlet />
      </main>
      <footer className="border-t border-line-soft">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-6 py-4 text-[13px] text-muted">
          <span>TWM Market — неофициальная площадка игроков. Не связана с разработчиками Amazing Online.</span>
          <span className="flex flex-wrap items-center gap-4">
            <VersionInfo />
            <ConnectionStatus />
          </span>
        </div>
      </footer>
    </div>
  );
}
