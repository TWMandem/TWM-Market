/**
 * Тестовые данные для снимков экранов: игроки, объявления с картинками,
 * переписка и сделка, история цены, жалоба, заявка на подтверждение ника,
 * ошибки. Работает с чистой базой и запущенным сервером API.
 *
 *   DATABASE_URL=… API_URL=http://localhost:3000 node seed.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import postgres from "postgres";
import sharp from "sharp";
import { API, OUT, totp } from "./lib.mjs";

const sql = postgres(process.env.DATABASE_URL, { max: 2, transform: postgres.camel });
const PASSWORD = "screenshots-password-1";

async function api(method, path, token, body) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${API}${path}`, { method, headers, body: payload });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/** Картинка-заглушка: градиент и подпись (как скриншот из игры). */
async function picture(label, colors, width = 1200, height = 675) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${width * 0.78}" cy="${height * 0.3}" r="${height * 0.22}" fill="rgba(255,255,255,0.12)"/>
    <text x="48" y="${height - 56}" font-family="DejaVu Sans, Arial" font-size="${Math.round(height / 11)}" font-weight="700" fill="white">${label}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function upload(path, token, png, name = "image.png") {
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), name);
  return api("POST", path, token, form);
}

async function player(login, nickname, serverNumber = 1, daysAgo = 40) {
  const auth = await api("POST", "/v1/auth/register", null, { login, email: `${login}@example.com`, password: PASSWORD, rulesAccepted: true });
  await sql`
    UPDATE users SET email_verified_at = now(), created_at = now() - make_interval(days => ${daysAgo}::int)
    WHERE id = ${auth.user.id}`;
  const profile = await api("POST", "/v1/me/game-profiles", auth.accessToken, { nickname, serverNumber });
  return { login, token: auth.accessToken, id: auth.user.id, profile };
}

async function item(name) {
  const [row] = await sql`SELECT id FROM catalog_items WHERE name = ${name} AND is_active LIMIT 1`;
  if (!row) throw new Error(`В справочнике нет «${name}»`);
  return row.id;
}
async function firstItem(categoryName) {
  const [row] = await sql`
    SELECT i.id, i.name FROM catalog_items i JOIN categories c ON c.id = i.category_id
    WHERE c.name = ${categoryName} AND i.is_active ORDER BY i.sort_order, i.id LIMIT 1`;
  if (!row) throw new Error(`В справочнике нет категории «${categoryName}»`);
  return row;
}

async function listing(owner, typeCode, catalogItemId, price, extra = {}, images = []) {
  const [type] = await sql`SELECT id FROM listing_types WHERE code = ${typeCode}`;
  const created = await api("POST", "/v1/listings", owner.token, {
    gameProfileId: owner.profile.id,
    listingTypeId: type.id,
    operation: "sell",
    catalogItemId,
    price,
    ...extra,
  });
  for (const png of images) await upload(`/v1/listings/${created.id}/images`, owner.token, png);
  return api("POST", `/v1/listings/${created.id}/publish`, owner.token);
}

await mkdir(OUT, { recursive: true });

// ── Администратор с двухфакторным входом ──────────────────────────────────
const adminAuth = await api("POST", "/v1/auth/register", null, { login: "admin_twm", email: "admin_twm@example.com", password: PASSWORD, rulesAccepted: true });
await sql`UPDATE users SET role = 'admin', email_verified_at = now() WHERE id = ${adminAuth.user.id}`;
const { secret } = await api("POST", "/v1/me/2fa/setup", adminAuth.accessToken);
await api("POST", "/v1/me/2fa/enable", adminAuth.accessToken, { code: totp(secret) });

// ── Игроки ────────────────────────────────────────────────────────────────
const ivan = await player("ivan_petrov", "Ivan_Petrov", 1, 120);
const kirill = await player("kirill", "Kirill_Smirnov", 1, 60);
const maks = await player("maks", "Maks_Volkov", 1, 30);
const fast = await player("fast_money", "Fast_Money", 1, 0);
await sql`UPDATE game_profiles SET verified_at = now() WHERE id = ${ivan.profile.id}`;
// Новичок без игрового профиля — для окна «Добро пожаловать».
const novice = await api("POST", "/v1/auth/register", null, { login: "novichok", email: "novichok@example.com", password: PASSWORD, rulesAccepted: true });
await sql`UPDATE users SET email_verified_at = now() WHERE id = ${novice.user.id}`;

// ── Объявления ────────────────────────────────────────────────────────────
const deadpool = await item("Одежда Дедпул");
const car = await firstItem("Легковые");
const accessory = await firstItem("Аксессуары");
const caseItem = await firstItem("Кейсы");

const ivanDeadpool = await listing(ivan, "item", deadpool, 2_500_000, { description: "Полный комплект, носил пару дней. Встречаемся у мэрии." }, [
  await picture("Одежда Дедпул", ["#7a1020", "#1b1f2a"]),
]);
const ivanCar = await listing(ivan, "vehicle", car.id, 18_200_000, { description: "Полный тюнинг, на ходу. Торг в игре.", dealPlaces: ["car_market"] }, [
  await picture(car.name, ["#1d3b6a", "#0e1014"]),
  await picture(`${car.name} — салон`, ["#3a3220", "#0e1014"]),
]);
await listing(ivan, "item", accessory.id, 350_000);
await listing(ivan, "item", caseItem.id, 120_000);
await listing(kirill, "item", deadpool, 2_800_000);
await listing(maks, "item", deadpool, 2_600_000);
const fastDeadpool = await listing(fast, "item", deadpool, 600_000, { description: "Срочно! Отдам первому, кто напишет." });
// Объявление со стоп-словом — уйдёт на проверку модератору.
await listing(kirill, "item", accessory.id, 400_000, { description: "Можно оплату переводом на карту" });

// ── История цены и просмотры ──────────────────────────────────────────────
const [server1] = await sql`SELECT id FROM servers WHERE number = 1`;
let median = 2_900_000;
for (let d = 45; d >= 1; d -= 1) {
  median = Math.round(median * (0.985 + ((d * 37) % 11) / 330));
  await sql`
    INSERT INTO price_snapshots (catalog_item_id, server_id, day, offers, median, average, min, max)
    VALUES (${deadpool}, ${server1.id}, current_date - ${d}::int, ${2 + (d % 4)}, ${median}, ${median + 80_000}, ${Math.round(median * 0.82)}, ${Math.round(median * 1.25)})
    ON CONFLICT DO NOTHING`;
}
for (let d = 29; d >= 0; d -= 1) {
  await sql`
    INSERT INTO listing_views_daily (listing_id, day, views)
    VALUES (${ivanDeadpool.id}, (now() AT TIME ZONE 'UTC' + interval '3 hours')::date - ${d}::int, ${3 + ((d * 7) % 13)})
    ON CONFLICT DO NOTHING`;
}
await sql`UPDATE listings SET views = 214 WHERE id = ${ivanDeadpool.id}`;
// Активность игроков для дашборда.
const everyone = [ivan, kirill, maks, fast];
for (let d = 29; d >= 0; d -= 1) {
  for (const [i, u] of everyone.entries()) {
    if ((d + i) % 3 === 0 || d < 3) {
      await sql`INSERT INTO user_activity_daily (user_id, day) VALUES (${u.id}, (now() AT TIME ZONE 'UTC' + interval '3 hours')::date - ${d}::int) ON CONFLICT DO NOTHING`;
    }
  }
}

// ── Переписка, сделка, отзыв ──────────────────────────────────────────────
const conv = await api("POST", `/v1/listings/${ivanDeadpool.id}/conversations`, maks.token);
await api("POST", `/v1/conversations/${conv.id}/messages`, maks.token, { body: "Здравствуйте! Костюм ещё продаётся?" });
await api("POST", `/v1/conversations/${conv.id}/messages`, ivan.token, { body: "Да, актуально. Могу встретиться у мэрии вечером." });
await api("POST", `/v1/conversations/${conv.id}/messages`, maks.token, { body: "Отлично, в 20:00 подойдёт?" });
await api("POST", `/v1/conversations/${conv.id}/messages`, ivan.token, { body: "Подойдёт, жду." });
await upload(`/v1/conversations/${conv.id}/images`, maks.token, await picture("Я у мэрии", ["#24503a", "#0e1014"], 960, 540), "screen.png");
const offered = await api("POST", `/v1/conversations/${conv.id}/offers`, maks.token, { price: 2_300_000 });
await api("POST", `/v1/conversations/${conv.id}/offers/${offered.offer.id}/accept`, ivan.token);
await api("POST", `/v1/conversations/${conv.id}/deal`, maks.token);
await api("POST", `/v1/conversations/${conv.id}/deal/confirm`, ivan.token);
await api("POST", `/v1/conversations/${conv.id}/review`, maks.token, { positive: true, comment: "Всё честно, быстро встретились. Рекомендую!" });

const conv2 = await api("POST", `/v1/listings/${ivanCar.id}/conversations`, maks.token);
await api("POST", `/v1/conversations/${conv2.id}/messages`, maks.token, { body: "Добрый вечер! Какой пробег у машины?" });
await api("POST", `/v1/conversations/${conv2.id}/messages`, ivan.token, { body: "Добрый! Машина в отличном состоянии, всё стоит." });
await api("POST", `/v1/conversations/${conv2.id}/offers`, maks.token, { price: 17_000_000 });

// ── Жалоба, заявка на подтверждение ника, подписки, шаблоны, ошибки ───────
await api("POST", "/v1/reports", maks.token, { targetType: "listing", targetId: fastDeadpool.id, reason: "scam", comment: "Просит сначала перевести деньги" });
await api("GET", `/v1/me/game-profiles/${maks.profile.id}/verification`, maks.token);
await upload(`/v1/me/game-profiles/${maks.profile.id}/verification`, maks.token, await picture("Статистика: Maks_Volkov", ["#2a2f3a", "#0e1014"], 900, 600), "stats.png");
const [clothes] = await sql`SELECT id FROM categories WHERE name = 'Одежда'`;
await api("POST", "/v1/me/saved-searches", maks.token, { name: "Одежда до 3 млн, сервер 1", section: "items", params: `section=items&category=${clothes.id}&server=1&priceMax=3000000`, notify: true });
await api("PUT", "/v1/me/chat-templates", ivan.token, { items: ["Здравствуйте! Да, актуально.", "Встречаемся у мэрии в 20:00.", "Цена окончательная."] });
await api("POST", `/v1/listings/${ivanCar.id}/favorite`, maks.token);
await api("POST", "/v1/client-errors", maks.token, { message: "TypeError: Cannot read properties of undefined (reading 'price')", stack: "TypeError: Cannot read properties of undefined\n    at PriceCard (index.js:1:2)", route: "/listing/…", version: "0.11.0" });

await writeFile(
  `${OUT}seed.json`,
  JSON.stringify(
    {
      password: PASSWORD,
      admin: { login: "admin_twm", totpSecret: secret },
      ivan: { login: ivan.login, id: ivan.id },
      maks: { login: maks.login, id: maks.id },
      fast: { login: fast.login, id: fast.id },
      listings: { ivanDeadpool: ivanDeadpool.id, ivanCar: ivanCar.id, fastDeadpool: fastDeadpool.id },
      conversation: conv.id,
      novice: "novichok",
      offerConversation: conv2.id,
    },
    null,
    2,
  ),
);
console.log("Тестовые данные готовы");
await sql.end();
