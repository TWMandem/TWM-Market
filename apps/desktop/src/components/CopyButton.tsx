import { useState } from "react";
import { useToast } from "../lib/toast";
import { Icon } from "./Icon";

/** Копирует текст в буфер обмена: ник для игры, ссылку на объявление. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Запасной путь для окон без доступа к Clipboard API.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function CopyButton({ text, label, done, className = "" }: { text: string; label: string; done: string; className?: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() =>
        void copyText(text).then((ok) => {
          toast(ok ? done : "Не удалось скопировать", ok ? "ok" : "error");
          if (ok) {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }
        })
      }
      className={`flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink ${className}`}
    >
      <Icon name={copied ? "check" : "copy"} size={17} className={copied ? "text-success" : ""} />
    </button>
  );
}
