import type { ReactNode } from "react";

/** Карточка по центру для экранов входа и регистрации. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex justify-center py-6">
      <div className="flex w-full max-w-[440px] flex-col gap-6 rounded-[var(--radius-card)] border border-line bg-surface p-8">
        <div className="flex flex-col gap-2">
          <h1 className="m-0 font-display text-[26px] font-bold">{title}</h1>
          {subtitle && <p className="m-0 text-[15px] leading-relaxed text-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
