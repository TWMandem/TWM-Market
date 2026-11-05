import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

export interface ActionItem {
  label: string;
  onSelect: () => void;
  /** Красным — для удаления и необратимых действий. */
  danger?: boolean;
  /** Текст повторного нажатия: действие выполняется только со второго раза. */
  confirm?: string;
  hint?: string;
}

/** Кнопка «⋯» с меню редких действий. Необратимые — с подтверждением повторным нажатием. */
export function ActionMenu({ items, label = "Ещё действия" }: { items: ActionItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setArmed(null);
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    box.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex size-11 items-center justify-center rounded-xl border border-line text-ink-2 transition-colors hover:border-faint hover:text-ink ${open ? "border-faint text-ink" : ""}`}
      >
        <Icon name="dots" size={22} strokeWidth={3} />
      </button>
      {open && (
        <div role="menu" className="menu-pop absolute right-0 top-12 z-30 flex w-[250px] flex-col rounded-2xl border border-line bg-surface p-1.5 shadow-2xl">
          {items.map((item, i) => {
            const isArmed = armed === i;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  if (item.confirm && !isArmed) {
                    setArmed(i);
                    return;
                  }
                  setOpen(false);
                  item.onSelect();
                }}
                className={`flex flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 text-left text-[15px] font-semibold outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 ${
                  item.danger || isArmed ? "text-danger-ink" : "text-ink-2 hover:text-ink"
                } ${isArmed ? "bg-danger-hover" : ""}`}
              >
                {isArmed ? item.confirm : item.label}
                {item.hint && !isArmed && <span className="text-[12px] font-medium text-faint">{item.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
