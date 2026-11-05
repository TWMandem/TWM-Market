import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import "@fontsource-variable/unbounded";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";
import { App } from "./App";
import { installErrorReporting } from "./lib/error-report";
import { initAndroidInsets } from "./lib/background-notify";
import { IS_ANDROID, IS_IOS, IS_WEB_APP } from "./lib/platform";
import { initTheme } from "./lib/theme";

installErrorReporting();
initTheme();

// Android: приложение, а не страница — без увеличения двумя пальцами,
// с отступами под строку состояния и панель жестов.
if (IS_ANDROID) {
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover");
  void initAndroidInsets();
}

// iPhone (веб-приложение): без увеличения страницы при нажатии на поле ввода
// и с отступами под «чёлку» и полоску «Домой» (env(safe-area-inset-*) в styles.css).
if (IS_WEB_APP && IS_IOS) {
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover");
}

const root = document.getElementById("root");
if (!root) throw new Error("Не найден элемент #root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
