import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { isTauri } from "./token-store";

/**
 * Автообновление. Приложение проверяет подписанный выпуск на GitHub
 * (через 15 секунд после запуска и потом каждые 6 часов). Обновление
 * ставится только по кнопке: установщик проверяет подпись выпуска,
 * поддельный файл не установится.
 */

export type UpdateStatus = "idle" | "checking" | "none" | "available" | "downloading" | "installing" | "error";

interface AppUpdateValue {
  /** Установленная версия; null — в браузере при разработке. */
  version: string | null;
  status: UpdateStatus;
  available: { version: string; notes: string; date: string | null } | null;
  /** Доля скачанного, 0…1; null — размер неизвестен. */
  progress: number | null;
  error: string | null;
  /** Баннер скрыт до следующего запуска. */
  dismissed: boolean;
  dismiss: () => void;
  checkNow: () => Promise<void>;
  install: () => Promise<void>;
}

const AppUpdateContext = createContext<AppUpdateValue | null>(null);

const FIRST_CHECK_MS = 15 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [available, setAvailable] = useState<AppUpdateValue["available"]>(null);
  const update = useRef<Update | null>(null);
  const busy = useRef(false);

  const checkNow = useCallback(async () => {
    if (!isTauri() || busy.current) return;
    busy.current = true;
    setStatus("checking");
    setError(null);
    try {
      const found = await check();
      update.current = found;
      if (found) {
        setAvailable({ version: found.version, notes: found.body ?? "", date: found.date ?? null });
        setStatus("available");
      } else {
        setAvailable(null);
        setStatus("none");
      }
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
    }
  }, []);

  const install = useCallback(async () => {
    const found = update.current;
    if (!found || busy.current) return;
    busy.current = true;
    setStatus("downloading");
    setProgress(null);
    setError(null);
    let total = 0;
    let done = 0;
    try {
      await found.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          setProgress(total ? 0 : null);
        } else if (event.event === "Progress") {
          done += event.data.chunkLength;
          if (total) setProgress(Math.min(1, done / total));
        } else if (event.event === "Finished") {
          setStatus("installing");
        }
      });
      // На Windows установщик сам закрывает и снова открывает приложение;
      // перезапуск здесь — на случай, если приложение ещё работает.
      await relaunch();
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
    const first = window.setTimeout(() => void checkNow(), FIRST_CHECK_MS);
    const timer = window.setInterval(() => void checkNow(), CHECK_EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [checkNow]);

  const value = useMemo<AppUpdateValue>(
    () => ({ version, status, available, progress, error, dismissed, dismiss: () => setDismissed(true), checkNow, install }),
    [version, status, available, progress, error, dismissed, checkNow, install],
  );
  return <AppUpdateContext.Provider value={value}>{children}</AppUpdateContext.Provider>;
}

export function useAppUpdate(): AppUpdateValue {
  const value = useContext(AppUpdateContext);
  if (!value) throw new Error("useAppUpdate должен вызываться внутри AppUpdateProvider");
  return value;
}
