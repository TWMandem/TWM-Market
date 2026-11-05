/** Понятное название устройства по строке User-Agent (и отметке версии TWM Market). */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Неизвестное устройство";
  const os = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/i.test(userAgent)
        ? "Android"
        : /Windows/i.test(userAgent)
          ? "Windows"
          : /Mac OS X/i.test(userAgent)
            ? "macOS"
            : /Linux/i.test(userAgent)
              ? "Linux"
              : "другая система";
  const client = /TWMClient\/(windows|android|web)/.exec(userAgent)?.[1];
  const app =
    client === "web"
      ? "веб-версия"
      : client
        ? "приложение"
        : // Входы из версий до 0.20: приложение Windows видно по движку Edge, Android — по WebView.
          /Edg\//.test(userAgent) || /; wv\)/.test(userAgent)
          ? "приложение"
          : /Chrome\/|Safari\/|Firefox\//.test(userAgent)
            ? "браузер"
            : "клиент";
  return `${app[0]!.toUpperCase()}${app.slice(1)} · ${os}`;
}
