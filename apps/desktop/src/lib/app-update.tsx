import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
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
 * На Android приложение скачивает APK выпуска с GitHub внутрь себя
 * (с проверкой SHA-256 из данных выпуска) и открывает системный установщик.
 * Android ставит его поверх, только если он подписан тем же ключом,
 * что и установленный.
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
  /** digest — «sha256:…», GitHub считает его сам для каждого файла выпуска. */
  assets: Array<{ name: string; browser_download_url: string; size: number; digest?: string | null }>;
}

interface ApkStatus {
  state: "idle" | "downloading" | "ready" | "error";
  downloaded: number;
  total: number;
  error?: string;
}

/**
 * ready — APK скачан, ждёт установщика (Android); permission — Android
 * просит разрешить установку приложений, после разрешения установка
 * продолжится сама.
 */
export type UpdateStatus = "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "permission" | "installing" | "error";

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
  /** Android: если в приложении скачать не вышло — скачать APK браузером. */
  downloadInBrowser: (() => Promise<void>) | null;
}

const AppUpdateContext = createContext<AppUpdateValue | null>(null);

/** Проверка вскоре после запуска — чтобы окно «Доступна новая версия» появилось само. */
const FIRST_CHECK_MS = 3 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [available, setAvailable] = useState<AppUpdateValue["available"]>(null);
  const update = useRef<Update | null>(null);
  const apk = useRef<{ url: string; sha256: string | null } | null>(null);
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
        const asset = release.assets.find((a) => a.name === APK_NAME);
        if (asset && newerVersion(release.tag_name, current)) {
          const digest = asset.digest?.startsWith("sha256:") ? asset.digest.slice(7) : null;
          apk.current = { url: asset.browser_download_url, sha256: digest };
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

  /** Android: открыть установщик для скачанного APK. */
  const openInstaller = useCallback(async () => {
    try {
      const result = await invoke<{ needsPermission?: boolean }>("plugin:apk-update|install");
      if (result.needsPermission) {
        // Открыты настройки: игрок разрешает установку и возвращается — продолжим сами.
        setStatus("permission");
      } else {
        setStatus("installing");
      }
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const installAndroid = useCallback(async () => {
    const target = apk.current;
    if (!target || busy.current) return;
    busy.current = true;
    setStatus("downloading");
    setProgress(null);
    setError(null);
    try {
      await invoke("plugin:apk-update|download", { url: target.url, sha256: target.sha256 });
      for (;;) {
        await new Promise((r) => window.setTimeout(r, 400));
        const s = await invoke<ApkStatus>("plugin:apk-update|status");
        if (s.total > 0) setProgress(Math.min(1, s.downloaded / s.total));
        if (s.state === "error") throw new Error(s.error ?? "Не удалось скачать обновление");
        if (s.state === "ready") break;
      }
      setStatus("ready");
      await openInstaller();
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
    }
  }, [openInstaller]);

  // Вернулись из настроек Android после разрешения установки — открываем установщик снова.
  useEffect(() => {
    if (status !== "permission") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void openInstaller();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [status, openInstaller]);

  const install = useCallback(async () => {
    if (isAndroidApp()) {
      if (status === "ready" || status === "permission" || status === "installing") await openInstaller();
      else await installAndroid();
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
  }, [status, installAndroid, openInstaller]);

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

  const downloadInBrowser = useCallback(async () => {
    if (apk.current) await openExternal(apk.current.url);
  }, []);

  const value = useMemo<AppUpdateValue>(
    () => ({
      version,
      status,
      available,
      progress,
      error,
      dismissed,
      dismiss: () => setDismissed(true),
      checkNow,
      install,
      downloadInBrowser: isAndroidApp() ? downloadInBrowser : null,
    }),
    [version, status, available, progress, error, dismissed, checkNow, install, downloadInBrowser],
  );
  return <AppUpdateContext.Provider value={value}>{children}</AppUpdateContext.Provider>;
}

export function useAppUpdate(): AppUpdateValue {
  const value = useContext(AppUpdateContext);
  if (!value) throw new Error("useAppUpdate должен вызываться внутри AppUpdateProvider");
  return value;
}
