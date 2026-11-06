import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

interface MenuPosition {
  left: number;
  top: number;
  maxHeight: number;
}

interface MenuPositionInput {
  trigger: Pick<DOMRect, "left" | "right" | "top" | "bottom">;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  bottomObstruction?: number;
  margin?: number;
  gap?: number;
}

/**
 * Помещает меню в видимую часть экрана. В мобильном приложении нижняя
 * навигация считается занятой областью, поэтому меню не прячется под ней.
 */
export function actionMenuPosition({
  trigger,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
  bottomObstruction = 0,
  margin = 8,
  gap = 8,
}: MenuPositionInput): MenuPosition {
  const rightEdge = Math.max(margin, viewportWidth - margin);
  const bottomEdge = Math.max(margin, viewportHeight - bottomObstruction - margin);
  const width = Math.min(menuWidth, Math.max(0, rightEdge - margin));
  const left = Math.min(Math.max(margin, trigger.right - width), Math.max(margin, rightEdge - width));
  const above = Math.max(0, trigger.top - gap - margin);
  const below = Math.max(0, bottomEdge - trigger.bottom - gap);
  const openAbove = menuHeight > below && above > below;
  const maxHeight = Math.max(0, openAbove ? above : below);
  const visibleHeight = Math.min(menuHeight, maxHeight);
  const top = openAbove ? Math.max(margin, trigger.top - gap - visibleHeight) : trigger.bottom + gap;
  return { left, top, maxHeight };
}

/** Кнопка «⋯» с меню редких действий. Необратимые — с подтверждением повторным нажатием. */
export function ActionMenu({ items, label = "Ещё действия" }: { items: ActionItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState<number | null>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      if (!trigger.current || !menu.current) return;
      const root = getComputedStyle(document.documentElement);
      const safeBottom = Number.parseFloat(root.getPropertyValue("--safe-bottom")) || 0;
      const mobileTabs = window.matchMedia("(max-width: 767px)").matches ? 64 + safeBottom : 0;
      const rect = trigger.current.getBoundingClientRect();
      setPosition(
        actionMenuPosition({
          trigger: rect,
          menuWidth: menu.current.offsetWidth,
          menuHeight: menu.current.scrollHeight,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          bottomObstruction: mobileTabs,
        }),
      );
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [open, items.length]);

  useEffect(() => {
    if (!open) {
      setArmed(null);
      return;
    }
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    menu.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="relative">
      <button
        ref={trigger}
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
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              maxHeight: position?.maxHeight,
              visibility: position ? "visible" : "hidden",
            }}
            className="menu-pop fixed z-50 flex w-[250px] max-w-[calc(100vw-1rem)] flex-col overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-1.5 shadow-2xl"
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
}
