import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import "@fontsource-variable/unbounded";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";
import { App } from "./App";
import { installErrorReporting } from "./lib/error-report";
import { initAndroidInsets } from "./lib/background-notify";
import { IS_ANDROID } from "./lib/platform";
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

const root = document.getElementById("root");
if (!root) throw new Error("Не найден элемент #root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
