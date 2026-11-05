import { defineConfig, type HtmlTagDescriptor, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";

// Сборка веб-приложения (twm-market.ru/app/, для iPhone и браузеров):
// VITE_WEB=1 vite build --base /app/ --outDir dist-web (скрипт build:web).
const WEB = process.env.VITE_WEB === "1";
const VERSION = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;

/** Веб-приложение: значок, манифест и настройки для экрана «Домой» iPhone. */
function webAppHead(): Plugin {
  return {
    name: "twm-web-app-head",
    transformIndexHtml(): HtmlTagDescriptor[] {
      if (!WEB) return [];
      const base = "/app/";
      const meta = (name: string, content: string): HtmlTagDescriptor => ({ tag: "meta", attrs: { name, content }, injectTo: "head" });
      return [
        { tag: "link", attrs: { rel: "manifest", href: `${base}manifest.webmanifest` }, injectTo: "head" },
        { tag: "link", attrs: { rel: "icon", type: "image/png", href: `${base}icons/icon-192.png` }, injectTo: "head" },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: `${base}icons/apple-touch-icon.png` }, injectTo: "head" },
        meta("theme-color", "#0e1014"),
        meta("apple-mobile-web-app-capable", "yes"),
        meta("mobile-web-app-capable", "yes"),
        meta("apple-mobile-web-app-title", "TWM Market"),
        // Приложение рисуется под строкой состояния; отступ даёт env(safe-area-inset-top).
        meta("apple-mobile-web-app-status-bar-style", "black-translucent"),
        meta("format-detection", "telephone=no"),
        meta("description", "Торговая площадка игроков Amazing Online: объявления, чаты и сделки."),
      ];
    },
  };
}

// Настройки рассчитаны на Tauri: фиксированный порт для режима разработки
// и сборка под движок WebView2 (Chromium), встроенный в Windows 10/11.
// Веб-приложению нужен ещё Safari: iPhone с iOS 16.4 и новее (там появились
// уведомления для сайтов на экране «Домой»).
export default defineConfig({
  plugins: [react(), tailwindcss(), webAppHead()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  // Номер версии для подвала веб-версии (в приложении его даёт Tauri).
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  build: {
    target: WEB ? ["chrome110", "safari16.4", "firefox115"] : "chrome110",
    sourcemap: false,
  },
});
