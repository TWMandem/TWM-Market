/// <reference types="vite/client" />

/** Версия из package.json (vite.config.ts). */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** "1" — сборка веб-приложения (twm-market.ru/app/, для iPhone). */
  readonly VITE_WEB?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
