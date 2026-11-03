import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type {
  AdminStatsDto,
  AuthResponseDto,
  GameProfileDto,
  ListingCardDto,
  ListingStatsDto,
  ListingTypeDto,
  MyListingDto,
  NotificationDto,
  PriceHistoryDto,
  SavedSearchDto,
} from "@twm/shared";
import { mskDay } from "../../lib/day.js";
import { bearer, createStaff, registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../../test-helpers.js";
import { notifySavedSearches } from "../saved-searches/routes.js";
import { snapshotPrices } from "./prices.js";

describe("статистика, история цен, похожие, подписки на поиск", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  let admin: AuthResponseDto;
  let itemTypeId: number;
  let categoryId: number;
  let otherCategoryId: number;

  type Method = "GET" | "POST" | "PATCH" | "DELETE";
  const call = (method: Method, url: string, token?: string, payload?: unknown) =>
    env.app.inject({ method, url, headers: token ? bearer(token) : {}, ...(payload === undefined ? {} : { payload: payload as object }) });

  const player = async (nickname: string, serverNumber = 3) => {
    const user = await registerUser(env);
    await env.database.sql`UPDATE users SET email_verified_at = now() WHERE id = ${user.user.id}`;
    const profile = (await call("POST", "/v1/me/game-profiles", user.accessToken, { nickname, serverNumber })).json() as GameProfileDto;
    return { ...user, profile };
  };

  let itemCounter = 0;
  const newItem = async (category = categoryId) => {
    itemCounter += 1;
    return ((await call("POST", "/v1/admin/catalog-items", admin.accessToken, { categoryId: category, name: `Товар ${itemCounter}` })).json() as { id: number }).id;
  };

  const publish = async (owner: { accessToken: string; profile: GameProfileDto }, catalogItemId: number, price: number, extra: Record<string, unknown> = {}) => {
    const created = await call("POST", "/v1/listings", owner.accessToken, {
      gameProfileId: owner.profile.id,
      listingTypeId: itemTypeId,
      operation: "sell",
      catalogItemId,
      price,
      ...extra,
    });
    assert.equal(created.statusCode, 201, created.body);
    const published = await call("POST", `/v1/listings/${(created.json() as MyListingDto).id}/publish`, owner.accessToken);
    assert.equal(published.statusCode, 200, published.body);
    return published.json() as MyListingDto;
  };

  before(async () => {
    env = await setupTestEnv();
    admin = await createStaff(env, "admin");
    const types = ((await call("GET", "/v1/admin/listing-types", admin.accessToken)).json() as { items: ListingTypeDto[] }).items;
    itemTypeId = types.find((t) => t.code === "item")!.id;
    categoryId = ((await call("POST", "/v1/admin/categories", admin.accessToken, { sectionCode: "items", name: "Оружие" })).json() as { id: number }).id;
    otherCategoryId = ((await call("POST", "/v1/admin/categories", admin.accessToken, { sectionCode: "items", name: "Одежда" })).json() as { id: number }).id;
  });
  after(async () => {
    await env.close();
  });

  test("просмотры по дням и статистика объявления для продавца", async () => {
    const seller = await player("Stat_Seller");
    const rival = await player("Stat_Rival");
    const viewer = await player("Stat_Viewer");
    const item = await newItem();
    const cheap = await publish(rival, item, 900_000);
    await publish(rival, await newItem(), 5_000);
    const mine = await publish(seller, item, 1_000_000);

    // Владелец свои просмотры не накручивает.
    await call("GET", `/v1/listings/${mine.id}`, seller.accessToken);
    await call("GET", `/v1/listings/${mine.id}`, viewer.accessToken);
    await call("GET", `/v1/listings/${mine.id}`);
    await call("POST", `/v1/listings/${mine.id}/favorite`, viewer.accessToken);

    const response = await call("GET", `/v1/me/listings/${mine.id}/stats`, seller.accessToken);
    assert.equal(response.statusCode, 200, response.body);
    const stats = response.json() as ListingStatsDto;
    assert.equal(stats.views, 2);
    assert.equal(stats.viewsToday, 2);
    assert.equal(stats.viewsByDay.length, 30);
    assert.deepEqual(stats.viewsByDay.at(-1), { date: mskDay(), value: 2 });
    assert.equal(stats.favorites, 1);
    assert.equal(stats.conversations, 0);
    assert.deepEqual(stats.position, { rank: 2, total: 2, median: 900_000, min: 900_000 });

    // Чужую статистику не видно.
    assert.equal((await call("GET", `/v1/me/listings/${cheap.id}/stats`, seller.accessToken)).statusCode, 404);
  });

  test("похожие предложения: тот же предмет первым, без своих и без самого объявления", async () => {
    const seller = await player("Sim_Seller");
    const other = await player("Sim_Other");
    const far = await player("Sim_Far", 5);
    const item = await newItem();
    const base = await publish(seller, item, 100_000);
    const ownOther = await publish(seller, await newItem(), 100_000); // своё — не показываем
    const sameItem = await publish(other, item, 150_000);
    const sameItemFar = await publish(far, item, 101_000);
    const sameCategory = await publish(other, await newItem(), 100_000);
    const otherCategory = await publish(other, await newItem(otherCategoryId), 100_000); // другая категория

    const response = await call("GET", `/v1/listings/${base.id}/similar`);
    assert.equal(response.statusCode, 200, response.body);
    const ids = (response.json() as { items: ListingCardDto[] }).items.map((i) => i.id);
    // Тот же предмет на своём сервере, тот же предмет на другом сервере, затем та же категория ближе по цене.
    assert.deepEqual(ids.slice(0, 3), [sameItem.id, sameItemFar.id, sameCategory.id]);
    assert.ok(!ids.includes(base.id) && !ids.includes(ownOther.id) && !ids.includes(otherCategory.id));
  });

  test("история цены: снимки по дням, текущие предложения и сделки", async () => {
    const a = await player("Price_A");
    const b = await player("Price_B");
    const c = await player("Price_C", 7);
    const buyer = await player("Price_Buyer");
    const item = await newItem();
    const sold = await publish(a, item, 100);
    await publish(b, item, 300);
    await publish(c, item, 1000);

    // Сделка по объявлению (как после подтверждения в переписке).
    const sql = env.database.sql;
    const [conversation] = await sql<{ id: string }[]>`
      INSERT INTO conversations (listing_id, buyer_id, seller_id) VALUES (${sold.id}, ${buyer.user.id}, ${a.user.id}) RETURNING id`;
    await sql`
      INSERT INTO deals (conversation_id, listing_id, buyer_id, seller_id, proposed_by, status, confirmed_at)
      VALUES (${conversation!.id}, ${sold.id}, ${buyer.user.id}, ${a.user.id}, ${buyer.user.id}, 'confirmed', now())`;

    assert.ok((await snapshotPrices(sql)) >= 2);
    assert.ok((await snapshotPrices(sql)) >= 2, "повторный снимок за день обновляет строку");

    const server3 = (await call("GET", `/v1/catalog/items/${item}/prices?server=3&days=30`)).json() as PriceHistoryDto;
    assert.equal(server3.server?.number, 3);
    assert.deepEqual(server3.current, { count: 2, average: 200, median: 200, min: 100, max: 300 });
    assert.deepEqual(server3.history, [{ date: mskDay(), offers: 2, median: 200, average: 200, min: 100, max: 300 }]);
    assert.equal(server3.deals.count, 1);
    assert.equal(server3.deals.recent[0]?.price, 100);

    const all = (await call("GET", `/v1/catalog/items/${item}/prices`)).json() as PriceHistoryDto;
    assert.equal(all.server, null);
    assert.equal(all.days, 90);
    assert.equal(all.current?.count, 3);
    assert.deepEqual(all.history, [{ date: mskDay(), offers: 3, median: null, average: 467, min: 100, max: 1000 }]);

    assert.equal((await call("GET", `/v1/catalog/items/${item}/prices?days=12`)).statusCode, 400);
    assert.equal((await call("GET", "/v1/catalog/items/999999/prices")).statusCode, 404);
  });

  test("подписка на поиск: сохранение, уведомление о новом объявлении, счётчик новых", async () => {
    const hunter = await player("Hunter");
    const seller = await player("Sub_Seller");
    const item = await newItem();
    const params = `section=items&type=${itemTypeId}&server=3&category=${categoryId}&priceMax=500000&page=2&sort=price_asc`;

    const created = await call("POST", "/v1/me/saved-searches", hunter.accessToken, { name: "Дешёвое оружие", section: "items", params });
    assert.equal(created.statusCode, 201, created.body);
    const saved = created.json() as SavedSearchDto;
    // Страница и сортировка не сохраняются, ключи по порядку.
    assert.equal(saved.params, `category=${categoryId}&priceMax=500000&section=items&server=3&type=${itemTypeId}`);
    assert.equal(saved.newCount, 0);
    assert.equal(saved.notify, true);

    const duplicate = await call("POST", "/v1/me/saved-searches", hunter.accessToken, { name: "Ещё раз", section: "items", params });
    assert.equal(duplicate.statusCode, 409);
    const broken = await call("POST", "/v1/me/saved-searches", hunter.accessToken, { name: "Плохой", section: "items", params: "evil=1" });
    assert.equal(broken.statusCode, 400);

    // Дорогое — не подходит, дешёвое — подходит.
    const expensive = await publish(seller, item, 900_000);
    assert.equal(await notifySavedSearches(env.database.sql, expensive.id), 0);
    const cheap = await publish(seller, await newItem(), 400_000);

    // Рассылка идёт в фоне — ждём уведомление.
    let notification: NotificationDto | undefined;
    for (let i = 0; i < 40 && !notification; i += 1) {
      const list = (await call("GET", "/v1/me/notifications", hunter.accessToken)).json() as { items: NotificationDto[] };
      notification = list.items.find((n) => n.kind === "saved_search");
      if (!notification) await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(notification, "уведомление пришло");
    assert.equal(notification.link, `/listing/${cheap.id}`);
    assert.equal(notification.title, "Новое по подписке «Дешёвое оружие»");

    // Сразу второе подходящее — без нового уведомления (пауза), но в счётчике.
    const second = await publish(seller, await newItem(), 300_000);
    assert.equal(await notifySavedSearches(env.database.sql, second.id), 0);

    let list = (await call("GET", "/v1/me/saved-searches", hunter.accessToken)).json() as { items: SavedSearchDto[] };
    assert.equal(list.items[0]?.newCount, 2);
    const seen = (await call("POST", `/v1/me/saved-searches/${saved.id}/seen`, hunter.accessToken)).json() as SavedSearchDto;
    assert.equal(seen.newCount, 0);

    const muted = await call("PATCH", `/v1/me/saved-searches/${saved.id}`, hunter.accessToken, { notify: false, name: "Оружие" });
    assert.equal((muted.json() as SavedSearchDto).name, "Оружие");
    assert.equal((muted.json() as SavedSearchDto).notify, false);

    // Свои объявления по своей подписке не присылаются; чужие подписки недоступны.
    const own = await call("POST", "/v1/me/saved-searches", seller.accessToken, { name: "Своё", section: "search", params: "q=Товар" });
    assert.equal(own.statusCode, 201, own.body);
    const third = await publish(seller, await newItem(), 200_000);
    assert.equal(await notifySavedSearches(env.database.sql, third.id), 0);
    assert.equal((await call("DELETE", `/v1/me/saved-searches/${saved.id}`, seller.accessToken)).statusCode, 404);

    assert.equal((await call("DELETE", `/v1/me/saved-searches/${saved.id}`, hunter.accessToken)).statusCode, 204);
    list = (await call("GET", "/v1/me/saved-searches", hunter.accessToken)).json() as { items: SavedSearchDto[] };
    assert.equal(list.items.length, 0);
  });

  test("объявления заблокированного игрока скрыты везде", async () => {
    const cheater = await player("Blocked_Seller");
    const buyer = await player("Blocked_Buyer");
    const item = await newItem();
    const listing = await publish(cheater, item, 777);
    const visible = (await call("GET", `/v1/listings?item=${item}`)).json() as { total: number };
    assert.equal(visible.total, 1);

    const blocked = await call("POST", `/v1/admin/users/${cheater.user.id}/block`, admin.accessToken, { reason: "Мошенничество" });
    assert.equal(blocked.statusCode, 200, blocked.body);

    assert.equal(((await call("GET", `/v1/listings?item=${item}`)).json() as { total: number }).total, 0, "нет в каталоге");
    assert.equal((await call("GET", `/v1/listings/${listing.id}`)).statusCode, 404, "карточка закрыта для гостя");
    assert.equal((await call("GET", `/v1/listings/${listing.id}`, buyer.accessToken)).statusCode, 404, "и для игрока");
    assert.equal((await call("GET", `/v1/listings/${listing.id}`, admin.accessToken)).statusCode, 200, "модератор видит");
    assert.equal((await call("POST", `/v1/listings/${listing.id}/conversations`, buyer.accessToken)).statusCode, 409, "написать нельзя");
    const prices = (await call("GET", `/v1/catalog/items/${item}/prices`)).json() as PriceHistoryDto;
    assert.equal(prices.current, null, "цена не учитывается");

    await call("POST", `/v1/admin/users/${cheater.user.id}/unblock`, admin.accessToken);
    assert.equal(((await call("GET", `/v1/listings?item=${item}`)).json() as { total: number }).total, 1, "после разблокировки снова видно");
  });

  test("дашборд: период, показатели по дням и сравнение", async () => {
    const response = await call("GET", "/v1/admin/stats?days=7", admin.accessToken);
    assert.equal(response.statusCode, 200, response.body);
    const stats = response.json() as AdminStatsDto;
    assert.equal(stats.days, 7);
    assert.equal(stats.metrics.registrations.byDay.length, 7);
    assert.ok(stats.metrics.registrations.total >= 10);
    assert.ok(stats.metrics.published.total >= 10);
    assert.ok(stats.metrics.views.total >= 2);
    assert.ok(stats.metrics.activeUsers.total >= 2, "заходившие игроки отмечаются");
    assert.equal(stats.metrics.deals.total, 1);
    assert.ok(stats.listings.active >= 10);
    assert.equal(stats.topCategories[0]?.name, "Оружие");
    assert.ok(stats.topItems.length >= 1);
    assert.equal((await call("GET", "/v1/admin/stats?days=5", admin.accessToken)).statusCode, 400);
  });
});
