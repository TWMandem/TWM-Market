import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { setReportedVersion } from "./error-report";
import { isAndroidApp, isDesktopApp, openExternal } from "./platform";
import { isTauri } from "./token-store";

/**
 * Автообновление. Приложение проверяет подписанный выпуск на GitHub
 * (через 15 секунд после запуска и потом каждые 6 часов). Обновление
 * ставится только по кнопке: установщик проверяет подпись выпуска,
 * поддельный файл не установится.
 *
 * На Android установить обновление само приложение не может: оно находит
 * новый выпуск и открывает в браузере ссылку на APK. Android ставит его
 * поверх, только если он подписан тем же ключом, что и установленный.
 */

const RELEASES_API = "https://api.github.com/repos/TWMandem/TWM-Market/releases/latest";
const APK_NAME = "TWM-Market.apk";

/** 0.16.0 > 0.15.2 и т. п. */
export function newerVersion(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

interface GithubRelease {
  tag_name: string;
  body: string | null;
  published_at: string | null;
  assets: Array<{ name: string; browser_download_url: string }>;
}

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
  const apkUrl = useRef<string | null>(null);
  const busy = useRef(false);

  const checkNow = useCallback(async () => {
    if (!isTauri() || busy.current) return;
    busy.current = true;
    setStatus("checking");
    setError(null);
    try {
      if (isAndroidApp()) {
        const current = await getVersion();
        const response = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
        if (!response.ok) throw new Error(`GitHub ответил ${response.status}`);
        const release = (await response.json()) as GithubRelease;
        const apk = release.assets.find((a) => a.name === APK_NAME);
        if (apk && newerVersion(release.tag_name, current)) {
          apkUrl.current = apk.browser_download_url;
          setAvailable({ version: release.tag_name.replace(/^v/, ""), notes: release.body ?? "", date: release.published_at });
          setStatus("available");
        } else {
          setAvailable(null);
          setStatus("none");
        }
        return;
      }
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
    if (isAndroidApp()) {
      if (apkUrl.current) await openExternal(apkUrl.current).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
      return;
    }
    if (!isDesktopApp()) return;
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
      .then((v) => {
        setVersion(v);
        setReportedVersion(v);
      })
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
