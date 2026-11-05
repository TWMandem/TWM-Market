import "@fontsource-variable/manrope";
import "@fontsource-variable/unbounded";
import "@fontsource-variable/jetbrains-mono";
import { initBoard } from "./board.js";
import { initDeal } from "./deal.js";
import { initPrice } from "./price.js";
import { initTour } from "./tour.js";

const REPO = "TWMandem/TWM-Market";
/** Постоянное имя установщика в каждом выпуске (после v0.11.0). */
const STABLE_ASSET = "TWM-Market-setup.exe";
/** Приложение для Android (с выпусков после 0.16.0, если в выпуске есть APK). */
const ANDROID_ASSET = "TWM-Market.apk";

for (const el of document.querySelectorAll("[data-year]")) el.textContent = String(new Date().getFullYear());

const mb = (bytes) => `${(bytes / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;

/**
 * Кнопки «Скачать» без скриптов ведут на страницу последней версии на GitHub.
 * Здесь они заменяются прямой ссылкой на установщик и подписывается версия.
 */
async function resolveDownload() {
  const links = document.querySelectorAll("[data-download]");
  if (links.length === 0) return;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return;
    const release = await response.json();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const apk = assets.find((a) => a.name === ANDROID_ASSET);
    if (apk) {
      for (const link of document.querySelectorAll("[data-download-android]")) {
        link.href = apk.browser_download_url;
        link.hidden = false;
      }
    }
    const asset = assets.find((a) => a.name === STABLE_ASSET) ?? assets.find((a) => /_x64-setup\.exe$/.test(a.name));
    if (!asset) return;
    for (const link of links) link.href = asset.browser_download_url;
    const version = String(release.tag_name ?? "").replace(/^v/, "");
    for (const el of document.querySelectorAll("[data-version]")) {
      el.textContent = apk
        ? `Версия ${version}. Бесплатно, для Windows 10 и 11 (${mb(asset.size)}) и Android 7+ (${mb(apk.size)})`
        : `Версия ${version}, ${mb(asset.size)}. Бесплатно, для Windows 10 и 11`;
    }
  } catch {
    // GitHub недоступен — остаётся ссылка на страницу версии.
  }
}

void resolveDownload();
initBoard();
initTour();
initPrice();
initDeal();
