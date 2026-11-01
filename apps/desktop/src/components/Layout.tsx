import { Outlet } from "react-router";
import { AppHeader } from "./AppHeader";
import { ConnectionStatus } from "./ConnectionStatus";

export function Layout() {
  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[1280px] flex-1 px-6 pb-16 pt-10">
        <Outlet />
      </main>
      <footer className="border-t border-line-soft">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-6 py-4 text-[13px] text-muted">
          <span>TWM Market — неофициальная площадка игроков. Не связана с разработчиками Amazing Online.</span>
          <ConnectionStatus />
        </div>
      </footer>
    </div>
  );
}
