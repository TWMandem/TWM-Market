import { THEME_OPTIONS, useTheme } from "../lib/theme";
import { Icon } from "./Icon";

/** Переключатель темы: как в Windows / тёмная / светлая. */
export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { preference, setPreference } = useTheme();
  return (
    <div role="radiogroup" aria-label="Тема оформления" className="flex gap-1 rounded-xl border border-line bg-ground p-1">
      {THEME_OPTIONS.map((o) => {
        const active = preference === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={compact ? o.label : undefined}
            title={compact ? o.label : undefined}
            onClick={() => setPreference(o.value)}
            className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg text-center font-bold leading-tight transition-colors ${compact ? "h-8 text-[13px]" : "min-h-10 px-2 py-1.5 text-sm max-sm:flex-col max-sm:gap-1 max-sm:text-[12px]"} ${
              active ? "bg-surface-2 text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            <Icon name={o.icon} size={compact ? 16 : 18} />
            {!compact && o.label}
          </button>
        );
      })}
    </div>
  );
}
