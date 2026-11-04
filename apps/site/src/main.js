import "@fontsource-variable/manrope";
import "@fontsource-variable/unbounded";

const REPO = "TWMandem/TWM-Market";
/** Постоянное имя установщика в каждом выпуске (с v0.11.0). */
const STABLE_ASSET = "TWM-Market-setup.exe";

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
    const asset = assets.find((a) => a.name === STABLE_ASSET) ?? assets.find((a) => /_x64-setup\.exe$/.test(a.name));
    if (!asset) return;
    for (const link of links) link.href = asset.browser_download_url;
    const version = String(release.tag_name ?? "").replace(/^v/, "");
    for (const el of document.querySelectorAll("[data-version]")) {
      el.textContent = `Версия ${version} · ${mb(asset.size)} · Windows 10 и 11 · бесплатно`;
    }
  } catch {
    // GitHub недоступен — остаётся ссылка на страницу версии.
  }
}

/** Цифры площадки (nginx отдаёт их с сервера API). Показываются, когда объявлений уже много. */
async function loadStats() {
  const block = document.querySelector("[data-stats]");
  if (!block) return;
  try {
    const response = await fetch("/stats.json");
    if (!response.ok) return;
    const stats = await response.json();
    if (typeof stats.listings !== "number" || stats.listings < 30) return;
    for (const el of block.querySelectorAll("[data-stat]")) {
      const value = stats[el.dataset.stat];
      if (typeof value === "number") el.textContent = value.toLocaleString("ru-RU");
    }
    block.hidden = false;
  } catch {
    // Нет цифр — блок просто не показывается.
  }
}

void resolveDownload();
void loadStats();
