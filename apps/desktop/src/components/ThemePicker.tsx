import { SEASON_LABELS } from "@twm/shared";
import { setSeasonDecorEnabled, useSeason } from "../lib/season";
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

/** Праздничное оформление (если администратор его включил): игрок может скрыть его у себя. */
export function SeasonToggle() {
  const { season, enabled } = useSeason();
  if (!season) return null;
  return (
    <label className="flex items-start gap-3 text-[15px]">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => setSeasonDecorEnabled(e.target.checked)}
        className="mt-1 size-4 accent-[var(--color-accent)]"
      />
      <span className="flex flex-col gap-0.5">
        Праздничное оформление: {SEASON_LABELS[season]}
        <span className="text-[13px] text-muted">Тыквы, летучие мыши и паутина на время праздника в игре. Настройка этого устройства.</span>
      </span>
    </label>
  );
}
