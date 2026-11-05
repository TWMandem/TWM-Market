/**
 * Снимки экранов приложения (интерфейс в браузере, без оболочки Tauri).
 * Нужны запущенные сервер API с тестовыми данными (seed.mjs) и интерфейс
 * (vite preview). Каждый экран снимается отдельно: если один не открылся,
 * остальные всё равно снимаются, а ошибка попадает в отчёт.
 *
 *   UI_URL=http://localhost:4173 node shoot.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { API, OUT, UI, totp } from "./lib.mjs";

const seed = JSON.parse(await readFile(`${OUT}seed.json`, "utf8"));
const SCREENS = `${OUT}screens/`;
await mkdir(SCREENS, { recursive: true });

const browser = await chromium.launch();
const results = [];
let counter = 0;

/** Ждёт, пока страница догрузится: нет запросов и пропали «Загружаю…». */
async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page
    .waitForFunction(() => !document.body.innerText.includes("Загружаю…"), null, { timeout: 8_000 })
    .catch(() => {});
  await page.waitForTimeout(400);
}

/** Телефон Android: экран 390×844, сенсорный ввод, браузер Android. */
const PHONE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
};

async function session(role, login, { server = true, theme = null, phone = false } = {}) {
  const context = await browser.newContext({
    ...(phone ? PHONE : { viewport: { width: 1280, height: 820 } }),
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
  });
  await context.addInitScript(
    ({ server, theme }) => {
      try {
        if (server) window.localStorage.setItem("twm:server", "1");
        if (theme) window.localStorage.setItem("twm:theme", theme);
      } catch {}
    },
    { server, theme },
  );
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`ошибка страницы: ${e.message}`));
  if (login) {
    await page.goto(`${UI}/#/login`);
    await page.getByLabel("Логин или email").fill(login);
    await page.getByLabel("Пароль", { exact: true }).fill(seed.password);
    await page.getByRole("button", { name: "Войти" }).click();
    await page.waitForURL((url) => !url.hash.startsWith("#/login"), { timeout: 15_000 });
    await settle(page);
  }
  return { role, page, context, problems };
}

/** Код 2FA: ждём новый 30-секундный шаг, чтобы код не совпал с уже использованным. */
async function freshTotp(secret) {
  const step = Math.floor(Date.now() / 30_000);
  while (Math.floor(Date.now() / 30_000) === step) await new Promise((r) => setTimeout(r, 500));
  return totp(secret);
}

/** Страница не из интерфейса (например, страница-ссылка с сервера API). */
async function rawShot(s, name, title, url) {
  return shot(s, name, title, null, async (page) => {
    await page.goto(url);
  });
}

async function shot(s, name, title, path, act) {
  counter += 1;
  const file = `${String(counter).padStart(2, "0")}-${name}.png`;
  const before = s.problems.length;
  const entry = { file, title, role: s.role, path, ok: true, problems: [] };
  try {
    if (path !== null) {
      await s.page.goto(`${UI}/#${path}`);
      await settle(s.page);
    }
    if (act) {
      await act(s.page);
      await settle(s.page);
    }
    await s.page.screenshot({ path: SCREENS + file, fullPage: true });
  } catch (error) {
    entry.ok = false;
    entry.problems.push(`не снят: ${error.message.split("\n")[0]}`);
    await s.page.screenshot({ path: SCREENS + file, fullPage: true }).catch(() => {});
  }
  entry.problems.push(...s.problems.slice(before));
  results.push(entry);
  console.log(`${entry.ok ? "✓" : "✗"} ${file} ${title}`);
}

const L = seed.listings;

// ── Гость ─────────────────────────────────────────────────────────────────
const guest = await session("гость");
await shot(guest, "home", "Главная", "/");
await shot(guest, "items", "Предметы", "/items");
await shot(guest, "cars", "Транспорт", "/cars");
await shot(guest, "listing", "Объявление", `/listing/${L.ivanDeadpool}`);
await shot(guest, "listing-car", "Объявление: транспорт", `/listing/${L.ivanCar}`);
await shot(guest, "user", "Профиль продавца", `/user/${seed.ivan.login}`);
await rawShot(guest, "share-page", "Ссылка на объявление (twm-market.ru/l/ID)", `${API}/share/l/${L.ivanDeadpool}`);
await shot(guest, "login", "Вход", "/login");
await shot(guest, "register", "Регистрация", "/register");
await guest.context.close();

// ── Первый запуск: сервер не выбран, у новичка нет игрового профиля ────────
const fresh = await session("гость, первый запуск", null, { server: false });
await shot(fresh, "home-first-run", "Главная: выбор сервера при первом запуске", "/");
await fresh.context.close();
const novice = await session("новичок", seed.novice, { server: false });
await shot(novice, "welcome-server", "Добро пожаловать: сервер", null);
await shot(novice, "welcome-nick", "Добро пожаловать: ник", null, async (page) => {
  await page.getByRole("radio", { name: /RED/ }).click();
  await page.getByRole("button", { name: "Дальше" }).click();
  await page.getByPlaceholder("Например, Ivan_Petrov").fill("Novichok_Igrok");
});
await shot(novice, "welcome-done", "Добро пожаловать: готово", null, async (page) => {
  await page.getByRole("button", { name: "Сохранить ник" }).click();
  await page.getByRole("heading", { name: "Всё готово" }).waitFor();
});
await novice.context.close();

// ── Покупатель ────────────────────────────────────────────────────────────
const buyer = await session("покупатель", seed.maks.login);
await shot(buyer, "listing-warning", "Подозрительно дешёвое объявление", `/listing/${L.fastDeadpool}`);
await shot(buyer, "chats", "Переписка", `/chats/${seed.conversation}`);
await shot(buyer, "offer-waiting", "Своё предложение цены ждёт ответа", `/chats/${seed.offerConversation}`);
await shot(buyer, "catalog-list", "Каталог списком, с фильтрами", "/items?priceMax=3000000&operation=sell", async (page) => {
  await page.getByRole("button", { name: "Списком" }).click();
});
await shot(buyer, "searches", "Подписки на поиск", "/my/searches");
await shot(buyer, "favorites", "Избранное", "/favorites");
await shot(buyer, "account", "Личный кабинет", "/account");
await shot(buyer, "account-delete", "Удаление аккаунта (форма, без отправки)", "/account", async (page) => {
  await page.getByRole("button", { name: "Удалить аккаунт…" }).click();
  await page.getByRole("button", { name: "Удалить аккаунт навсегда" }).scrollIntoViewIfNeeded();
});
await shot(buyer, "account-notifications", "Личный кабинет: уведомления и тема", "/account#notifications", async (page) => {
  await page.waitForTimeout(800);
});
await buyer.context.close();

// ── Светлая тема ──────────────────────────────────────────────────────────
const light = await session("покупатель, светлая тема", seed.maks.login, { theme: "light" });
await shot(light, "light-home", "Светлая тема: главная", "/");
await shot(light, "light-catalog", "Светлая тема: каталог", "/items");
await shot(light, "light-listing", "Светлая тема: объявление", `/listing/${L.ivanCar}`);
await shot(light, "light-chats", "Светлая тема: переписка", `/chats/${seed.offerConversation}`);
await shot(light, "light-favorites", "Светлая тема: избранное", "/favorites");
await shot(light, "light-account", "Светлая тема: личный кабинет", "/account");
await shot(light, "light-menu", "Светлая тема: меню аккаунта", "/", async (page) => {
  await page.getByRole("button", { name: /^Аккаунт / }).click();
});
await light.context.close();

// ── Телефон (Android) ────────────────────────────────────────────────────
const phone = await session("покупатель, телефон", seed.maks.login, { phone: true });
await shot(phone, "phone-home", "Телефон: главная", "/");
await shot(phone, "phone-catalog", "Телефон: каталог", "/items");
await shot(phone, "phone-catalog-filters", "Телефон: каталог, фильтры открыты", "/items", async (page) => {
  await page.getByRole("button", { name: "Фильтры" }).click();
});
await shot(phone, "phone-listing", "Телефон: объявление", `/listing/${L.ivanCar}`);
await shot(phone, "phone-chats", "Телефон: сообщения", "/chats");
await shot(phone, "phone-chat", "Телефон: переписка", `/chats/${seed.offerConversation}`);
await shot(phone, "phone-favorites", "Телефон: избранное", "/favorites");
await shot(phone, "phone-new-listing", "Телефон: новое объявление", "/listings/new");
await shot(phone, "phone-account", "Телефон: личный кабинет", "/account");
await shot(phone, "phone-menu", "Телефон: меню аккаунта", "/", async (page) => {
  await page.getByRole("button", { name: /^Аккаунт / }).click();
});
await shot(phone, "phone-server", "Телефон: выбор сервера", "/", async (page) => {
  await page.getByRole("button", { name: /^Мой сервер/ }).click();
});
await phone.context.close();
const phoneGuest = await session("гость, телефон", null, { phone: true });
await shot(phoneGuest, "phone-login", "Телефон: вход", "/login");
await shot(phoneGuest, "phone-user", "Телефон: профиль продавца", `/user/${seed.ivan.login}`);
await phoneGuest.context.close();

// ── Продавец ──────────────────────────────────────────────────────────────
const seller = await session("продавец", seed.ivan.login);
await shot(seller, "my-listings", "Мои объявления", "/my/listings");
await shot(seller, "my-listings-menu", "Мои объявления: меню действий", "/my/listings", async (page) => {
  await page.getByRole("button", { name: /^Ещё действия/ }).first().click();
});
await shot(seller, "account-menu", "Меню аккаунта", "/", async (page) => {
  await page.getByRole("button", { name: /^Аккаунт / }).click();
});
await shot(seller, "own-listing", "Своё объявление со статистикой", `/listing/${L.ivanDeadpool}`);
await shot(seller, "edit-listing", "Редактирование объявления", `/listings/${L.ivanCar}/edit`);
await shot(seller, "new-listing", "Новое объявление", "/listings/new");
await shot(seller, "chat-templates", "Шаблоны ответов в переписке", `/chats/${seed.conversation}`, async (page) => {
  await page.getByRole("button", { name: "Шаблоны ответов" }).click();
});
await shot(seller, "offer-incoming", "Предложение цены от покупателя", `/chats/${seed.offerConversation}`);
await shot(seller, "offer-counter", "Встречное предложение цены", `/chats/${seed.offerConversation}`, async (page) => {
  await page.getByRole("button", { name: "Своя цена" }).click();
  await page.getByLabel("Ваша цена").fill("17.6кк");
});
await seller.context.close();

// ── Администратор ─────────────────────────────────────────────────────────
const admin = await session("администратор", seed.admin.login);
await shot(admin, "admin-2fa", "Код подтверждения для админ-панели", "/admin");
await shot(admin, "admin-dashboard", "Админ-панель: сводка", null, async (page) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.getByLabel("Код из приложения").fill(await freshTotp(seed.admin.totpSecret));
    await page.getByRole("button", { name: "Открыть админ-панель" }).click();
    const opened = await page
      .getByLabel("Код из приложения")
      .waitFor({ state: "detached", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
  }
  throw new Error("Код 2FA не принят");
});
for (const tab of ["Объявления на проверке", "Жалобы", "Подтверждение ников"]) {
  await shot(admin, "admin-moderation", `Модерация: ${tab}`, "/admin/moderation", async (page) => {
    await page.getByRole("tab", { name: new RegExp(tab) }).click();
  });
}
await shot(admin, "admin-listings", "Все объявления", "/admin/listings");
await shot(admin, "admin-users", "Пользователи", "/admin/users");
await shot(admin, "admin-user", "Игрок: активность", `/admin/users/${seed.ivan.id}`);
await shot(admin, "admin-errors", "Ошибки", "/admin/errors");
await admin.context.close();

await browser.close();

// ── Отчёт ─────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
const noisy = results.filter((r) => r.problems.length > 0);
const lines = [
  `## Снимки экранов: ${results.length - failed.length} из ${results.length}`,
  "",
  failed.length ? `Не сняты: ${failed.map((r) => r.file).join(", ")}` : "Все экраны сняты.",
  noisy.length ? `Экранов с ошибками в консоли: ${noisy.length}` : "Ошибок в консоли нет.",
  "",
  "| Файл | Экран | Кто | Замечания |",
  "|---|---|---|---|",
  ...results.map((r) => `| ${r.file} | ${r.title} | ${r.role} | ${r.problems.map((p) => p.replace(/\|/g, "\\|").slice(0, 200)).join("<br>") || "—"} |`),
];
await writeFile(`${OUT}report.md`, lines.join("\n") + "\n");
await writeFile(`${OUT}report.json`, JSON.stringify(results, null, 2));
console.log(lines.slice(0, 4).join("\n"));
