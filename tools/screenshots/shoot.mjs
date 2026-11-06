/**
 * Снимки экранов приложения (интерфейс в браузере, без оболочки Tauri).
 * Нужны запущенные сервер API с тестовыми данными (seed.mjs) и интерфейс
 * (vite preview). Каждый экран снимается отдельно: если один не открылся,
 * остальные всё равно снимаются, а ошибка попадает в отчёт.
 *
 *   UI_URL=http://localhost:4173 node shoot.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, devices, webkit } from "playwright";
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

async function session(role, login, { server = true, theme = null, phone = false, scale = 1 } = {}) {
  const context = await browser.newContext({
    ...(phone ? PHONE : { viewport: { width: 1280, height: 820 } }),
    deviceScaleFactor: scale,
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
await shot(phone, "phone-notifications", "Телефон: уведомления", "/", async (page) => {
  await page.getByRole("button", { name: /^Уведомления/ }).click();
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
await shot(admin, "admin-appearance", "Оформление (праздники)", "/admin/appearance");
await admin.context.close();

// ── Снимки для сайта twm-market.ru ────────────────────────────────────────
// Окно приложения для «камеры» на главной (apps/site/src/tour.js): снимок и
// области, которые приближаются на каждом шаге, плюс экраны телефона.
// Кладутся рядом со снимками (screens/site-*), области — в screens/site.json.
{
  const site = {};
  const box = async (locator) => {
    const b = await locator.first().boundingBox();
    return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null;
  };
  const card = (page, text) => page.locator("section", { hasText: text }).last();
  try {
    const guestSite = await session("сайт", null);
    await guestSite.page.goto(`${UI}/#/listing/${L.ivanDeadpool}`);
    await settle(guestSite.page);
    await guestSite.page.waitForTimeout(800);
    const p = guestSite.page;
    site.tour = {
      price: await box(p.locator("#price-card")),
      history: await box(card(p, "История цены")),
      seller: await box(card(p, "Все отзывы")),
    };
    await p.screenshot({ path: `${SCREENS}site-tour.png`, fullPage: true, clip: { x: 0, y: 0, width: 1280, height: 1300 } });
    await guestSite.context.close();

    const sellerSite = await session("сайт", seed.ivan.login);
    await sellerSite.page.goto(`${UI}/#/chats/${seed.offerConversation}`);
    await settle(sellerSite.page);
    await sellerSite.page.waitForTimeout(800);
    site.chat = { offer: await box(sellerSite.page.locator("div", { has: sellerSite.page.getByRole("button", { name: "Своя цена" }) }).last()) };
    await sellerSite.page.screenshot({ path: `${SCREENS}site-chat.png` });
    await sellerSite.context.close();

    const phoneSite = await session("сайт, телефон", seed.maks.login, { phone: true, scale: 2 });
    for (const [name, path] of [
      ["home", "/"],
      ["listing", `/listing/${L.ivanCar}`],
      ["chat", `/chats/${seed.offerConversation}`],
    ]) {
      await phoneSite.page.goto(`${UI}/#${path}`);
      await settle(phoneSite.page);
      await phoneSite.page.waitForTimeout(600);
      await phoneSite.page.screenshot({ path: `${SCREENS}site-phone-${name}.png` });
    }
    await phoneSite.context.close();
    await writeFile(`${SCREENS}site.json`, JSON.stringify(site, null, 2));
    console.log("✓ снимки для сайта", JSON.stringify(site));
  } catch (error) {
    console.log(`✗ снимки для сайта: ${error.message.split("\n")[0]}`);
  }
}

// ── Сайт twm-market.ru из сборки (apps/site/dist), без отдельного сервера ──
{
  const DIST = new URL("../../apps/site/dist/", import.meta.url);
  const TYPES = { html: "text/html", js: "text/javascript", css: "text/css", svg: "image/svg+xml", webp: "image/webp", jpg: "image/jpeg", png: "image/png", woff2: "font/woff2", json: "application/json", txt: "text/plain", xml: "application/xml" };
  for (const [name, viewport] of [
    ["site-page", { width: 1280, height: 900 }],
    ["site-page-phone", { width: 390, height: 844 }],
  ]) {
    try {
      const context = await browser.newContext({ viewport, locale: "ru-RU" });
      await context.route("http://site.test/**", async (route) => {
        let path = new URL(route.request().url()).pathname;
        // Цифры площадки и праздничное оформление — с сервера API, как nginx на сайте.
        if (path === "/stats.json") {
          const response = await fetch(`${API}/v1/public/stats`);
          await route.fulfill({ status: response.status, body: await response.text(), contentType: "application/json" });
          return;
        }
        if (path.endsWith("/")) path += "index.html";
        try {
          const body = await readFile(new URL(`.${path}`, DIST));
          await route.fulfill({ body, contentType: TYPES[path.split(".").pop()] ?? "application/octet-stream" });
        } catch {
          await route.fulfill({ status: 404, body: "" });
        }
      });
      const page = await context.newPage();
      await page.goto("http://site.test/");
      await page.waitForTimeout(1500);
      // Анимации появления при прокрутке: проходим страницу, чтобы всё показалось.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SCREENS}${name}.png`, fullPage: true });
      await context.close();
      console.log(`✓ ${name}`);
    } catch (error) {
      console.log(`✗ ${name}: ${error.message.split("\n")[0]}`);
    }
  }
}

// ── Веб-версия в браузере на компьютере (Chromium) ──
if (process.env.WEB_URL) {
  const WEB = process.env.WEB_URL.replace(/\/+$/, "");
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, locale: "ru-RU", timezoneId: "Europe/Moscow" });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("twm:server", "1");
    } catch {}
  });
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`ошибка страницы: ${e.message}`));
  const s = { role: "веб-версия, компьютер", page, context, problems };
  const shotWeb = async (name, title, path, act) => {
    counter += 1;
    const file = `${String(counter).padStart(2, "0")}-${name}.png`;
    const before = problems.length;
    const entry = { file, title, role: s.role, path, ok: true, problems: [] };
    try {
      await page.goto(`${WEB}/#${path}`);
      await settle(page);
      if (act) {
        await act(page);
        await settle(page);
      }
      await page.screenshot({ path: SCREENS + file, fullPage: true });
    } catch (error) {
      entry.ok = false;
      entry.problems.push(`не снят: ${error.message.split("\n")[0]}`);
    }
    entry.problems.push(...problems.slice(before));
    results.push(entry);
    console.log(`${entry.ok ? "✓" : "✗"} ${file} ${title}`);
  };
  try {
    await page.goto(`${WEB}/#/login`);
    await page.getByLabel("Логин или email").fill(seed.maks.login);
    await page.getByLabel("Пароль", { exact: true }).fill(seed.password);
    await page.getByRole("button", { name: "Войти" }).click();
    await page.waitForURL((url) => !url.hash.startsWith("#/login"), { timeout: 15_000 });
    await settle(page);
    await shotWeb("web-home", "Веб-версия: главная", "/");
    {
      const fpsChromium = await page.evaluate(
        () =>
          new Promise((resolve) => {
            let frames = 0;
            const start = performance.now();
            const tick = () => {
              frames += 1;
              if (performance.now() - start < 2000) requestAnimationFrame(tick);
              else resolve(Math.round(frames / ((performance.now() - start) / 1000)));
            };
            requestAnimationFrame(tick);
          }),
      );
      console.log(`  Веб-версия (Chromium): главная, кадров/с — ${fpsChromium}`);
      results.push({ file: "—", title: "Веб-версия: плавность главной (кадров/с)", role: s.role, path: null, ok: true, problems: [`${fpsChromium}`] });
    }
    await shotWeb("web-notifications", "Веб-версия: уведомления", "/", async (p) => {
      await p.getByRole("button", { name: /^Уведомления/ }).click();
    });
    await shotWeb("web-account", "Веб-версия: личный кабинет", "/account");
    // Хеллоуин: призрак пролетает — ловим его, счёт растёт.
    await shotWeb("web-ghost", "Хеллоуин: пролетает призрак", "/", async (p) => {
      await p.evaluate(() => window.dispatchEvent(new Event("twm:ghost-now")));
      await p.waitForTimeout(3500);
    });
    {
      const entry = { file: "—", title: "Хеллоуин: призрака можно поймать", role: s.role, path: null, ok: true, problems: [] };
      try {
        await page.evaluate(() => window.dispatchEvent(new Event("twm:ghost-now")));
        await page.waitForTimeout(2500);
        await page.getByRole("button", { name: "Поймать призрака" }).dispatchEvent("click");
        await page.getByText(/Поймано призраков: \d+/).waitFor({ timeout: 5000 });
      } catch (error) {
        entry.ok = false;
        entry.problems.push(error.message.split("\n")[0]);
      }
      results.push(entry);
      console.log(`${entry.ok ? "✓" : "✗"} ${entry.title} ${entry.problems.join("; ")}`);
    }
    // Две вкладки одновременно обновляют вход — сессия не должна закрыться.
    const second = await context.newPage();
    await Promise.all([page.reload(), second.goto(`${WEB}/#/account`)]);
    await Promise.all([settle(page), settle(second)]);
    await page.reload();
    await settle(page);
    const footer = await page.locator("footer").innerText();
    const still = await page.getByRole("button", { name: /^Аккаунт / }).count();
    const entry = { file: "—", title: "Веб-версия: две вкладки, подвал с версией", role: s.role, path: null, ok: true, problems: [] };
    if (!/Веб-версия \d+\.\d+\.\d+/.test(footer)) entry.problems.push(`в подвале нет версии: ${footer.slice(0, 120)}`);
    if (still === 0) entry.problems.push("после открытия второй вкладки вход потерян");
    entry.ok = entry.problems.length === 0;
    results.push(entry);
    console.log(`${entry.ok ? "✓" : "✗"} ${entry.title} ${entry.problems.join("; ")}`);
  } catch (error) {
    results.push({ file: "—", title: "Веб-версия: вход", role: s.role, path: null, ok: false, problems: [error.message.split("\n")[0], ...problems] });
  }
  await context.close();
}

await browser.close();

// ── Веб-приложение на iPhone (twm-market.ru/app/): движок Safari (WebKit) ──
// Проверяем, что сборка build:web запускается в Safari без ошибок, раскладка
// с «чёлкой» и полоской «Домой» не ломается, служебный скрипт регистрируется.
if (process.env.WEB_URL) {
  const WEB = process.env.WEB_URL.replace(/\/+$/, "");
  let iphoneBrowser = null;
  try {
    iphoneBrowser = await webkit.launch();
  } catch (error) {
    results.push({ file: "—", title: "iPhone: запуск WebKit", role: "iPhone", path: null, ok: false, problems: [error.message.split("\n")[0]] });
  }
  if (iphoneBrowser) {
    for (const standalone of [false, true]) {
      const role = standalone ? "iPhone, с экрана «Домой»" : "iPhone, Safari";
      const context = await iphoneBrowser.newContext({ ...devices["iPhone 13"], locale: "ru-RU", timezoneId: "Europe/Moscow" });
      await context.addInitScript((standalone) => {
        try {
          window.localStorage.setItem("twm:server", "1");
          // Открыто с экрана «Домой» (navigator.standalone в Safari на iPhone).
          if (standalone) Object.defineProperty(Navigator.prototype, "standalone", { get: () => true });
        } catch {}
      }, standalone);
      const page = await context.newPage();
      const problems = [];
      page.on("console", (m) => {
        if (m.type() === "error") problems.push(`console: ${m.text()}`);
      });
      page.on("pageerror", (e) => problems.push(`ошибка страницы: ${e.message}`));
      const s = { role, page, context, problems };
      const go = async (name, title, path, act) => {
        counter += 1;
        const file = `${String(counter).padStart(2, "0")}-${name}.png`;
        const before = problems.length;
        const entry = { file, title, role, path, ok: true, problems: [] };
        try {
          await page.goto(`${WEB}/#${path}`);
          await settle(page);
          if (act) {
            await act(page);
            await settle(page);
          }
          // Без прокрутки — как видно на экране телефона; кабинет — целиком.
          await page.screenshot({ path: SCREENS + file, fullPage: name.endsWith("account") });
        } catch (error) {
          entry.ok = false;
          entry.problems.push(`не снят: ${error.message.split("\n")[0]}`);
          // Подробности Playwright (что перехватывает нажатие и т. п.) — в журнал.
          console.log(error.message.split("\n").slice(0, 25).join("\n"));
          await page.screenshot({ path: SCREENS + file }).catch(() => {});
        }
        entry.problems.push(...problems.slice(before));
        results.push(entry);
        console.log(`${entry.ok ? "✓" : "✗"} ${file} ${title}`);
      };
      const tag = standalone ? "iphone-app" : "iphone";
      try {
        if (!standalone) await go(`${tag}-guest`, `${role}: главная, гость`, "/");
        await page.goto(`${WEB}/#/login`);
        await page.getByLabel("Логин или email").fill(seed.maks.login);
        await page.getByLabel("Пароль", { exact: true }).fill(seed.password);
        await page.getByRole("button", { name: "Войти" }).click();
        await page.waitForURL((url) => !url.hash.startsWith("#/login"), { timeout: 15_000 });
        await settle(page);
        await go(`${tag}-home`, `${role}: главная`, "/");
        if (standalone) {
          await go(`${tag}-listing`, `${role}: объявление`, `/listing/${L.ivanCar}`);
          await go(`${tag}-chat`, `${role}: переписка`, `/chats/${seed.offerConversation}`);
          await go(`${tag}-new-listing`, `${role}: новое объявление`, "/listings/new");
        }
        // Плавность главной в WebKit: кадров в секунду с праздничной анимацией и без неё.
        const fps = async () =>
          page.evaluate(
            () =>
              new Promise((resolve) => {
                let frames = 0;
                const start = performance.now();
                const tick = () => {
                  frames += 1;
                  if (performance.now() - start < 2000) requestAnimationFrame(tick);
                  else resolve(Math.round(frames / ((performance.now() - start) / 1000)));
                };
                requestAnimationFrame(tick);
              }),
          );
        await page.goto(`${WEB}/#/`);
        await settle(page);
        // Что мешает отрисовке: по очереди прячем части оформления и меряем.
        const variants = [
          ["всё оформление", ""],
          ["без сцены", ".hw-scene{display:none!important}"],
          ["без тумана и искр", ".hw-mist{display:none!important}"],
          ["без will-change", "*{will-change:auto!important}"],
          ["без фона fixed", "body{background-attachment:scroll!important;background-image:none!important}"],
          ["без паутинок разделов", ".hw-tile::after{display:none!important}"],
          ["без анимаций вообще", "*,*::before,*::after{animation:none!important}"],
        ];
        const measured = [];
        for (const [name, css] of variants) {
          const handle = css ? await page.addStyleTag({ content: css }) : null;
          const value = await Promise.race([fps(), new Promise((r) => setTimeout(() => r("нет кадров"), 6000))]);
          measured.push(`${name}: ${value}`);
          if (handle) await handle.evaluate((el) => el.remove());
        }
        const measure = () => Promise.race([fps(), new Promise((r) => setTimeout(() => r("нет кадров"), 6000))]);
        {
          const handle = await page.addStyleTag({ content: '[class*="hw-"]{display:none!important}' });
          measured.push(`всё оформление скрыто разом: ${await measure()}`);
          await handle.evaluate((el) => el.remove());
        }
        await page.goto(`${WEB}/#/account`);
        await settle(page);
        measured.push(`личный кабинет: ${await measure()}`);
        await page.goto(`${WEB}/#/search`);
        await settle(page);
        measured.push(`каталог: ${await measure()}`);
        // Праздничное оформление выключено в настройках — его элементов нет вовсе.
        await page.evaluate(() => {
          for (const key of Object.keys(localStorage)) if (/seasonDecor/.test(key)) localStorage.setItem(key, "off");
          localStorage.setItem("twm:seasonDecor", "off");
          localStorage.setItem("seasonDecor", "off");
        });
        await page.goto(`${WEB}/?nodecor#/`);
        await settle(page);
        measured.push(`главная без праздника: ${await measure()} (season=${await page.evaluate(() => document.documentElement.dataset.season ?? "нет")})`);
        await page.evaluate(() => {
          for (const key of Object.keys(localStorage)) if (/seasonDecor/.test(key)) localStorage.setItem(key, "on");
        });
        console.log(`  ${role}: главная, кадров/с — ${measured.join("; ")}`);
        results.push({ file: "—", title: `${role}: плавность главной (кадров/с)`, role, path: null, ok: true, problems: measured });
        await page.goto(`${WEB}/#/account`);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await go(`${tag}-notifications`, `${role}: уведомления (без анимации)`, "/", async (p) => {
          await p.getByRole("button", { name: /^Уведомления/ }).click();
        });
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await go(`${tag}-account`, `${role}: личный кабинет, уведомления`, "/account");
        // Служебный скрипт уведомлений и манифест на месте.
        const check = await page.evaluate(async () => {
          const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
          const manifest = document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null;
          const icon = document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") ?? null;
          const scroll = document.documentElement.scrollWidth - window.innerWidth;
          return { sw: reg ? reg.active?.scriptURL ?? reg.installing?.scriptURL ?? "есть" : null, push: "PushManager" in window, manifest, icon, scroll };
        });
        console.log(`  ${role}: ${JSON.stringify(check)}`);
        const entry = { file: "—", title: `${role}: манифест, значок, без горизонтальной прокрутки`, role, path: null, ok: true, problems: [] };
        if (!check.manifest || !check.icon) entry.problems.push("нет манифеста или значка для экрана «Домой»");
        if (check.scroll > 1) entry.problems.push(`горизонтальная прокрутка: ${check.scroll}px`);
        entry.problems.push(`служебный скрипт: ${check.sw ?? "нет (в этой сборке WebKit)"}; Web Push: ${check.push ? "есть" : "нет (в этой сборке WebKit)"}`);
        entry.ok = Boolean(check.manifest && check.icon && check.scroll <= 1);
        results.push(entry);
      } catch (error) {
        results.push({ file: "—", title: `${role}: вход`, role, path: null, ok: false, problems: [error.message.split("\n")[0], ...problems] });
        console.log(`✗ ${role}: ${error.message.split("\n")[0]}`);
      }
      await s.context.close();
    }
    await iphoneBrowser.close();
  }
}

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
