import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AuthResponseDto, FavoriteItemDto, GameProfileDto, ListingTypeDto, MeDto, MyListingDto, NotificationDto } from "@twm/shared";
import { archiveExpired } from "../modules/listings/service.js";
import { bearer, createStaff, registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../test-helpers.js";

describe("слежение за избранным", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  let admin: AuthResponseDto;
  let seller: AuthResponseDto;
  let profile: GameProfileDto;
  let itemTypeId: number;
  let categoryId: number;
  let counter = 0;

  const call = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, token?: string, payload?: unknown) =>
    env.app.inject({ method, url, headers: token ? bearer(token) : {}, ...(payload === undefined ? {} : { payload: payload as object }) });

  const body = (catalogItemId: number, price: number, operation = "sell") => ({
    gameProfileId: profile.id,
    listingTypeId: itemTypeId,
    operation,
    catalogItemId,
    price,
    description: "Встречаемся у банка",
  });

  /** Новое опубликованное объявление (каждый раз — новый предмет, чтобы не было дублей). */
  const publish = async (price: number, operation = "sell") => {
    counter += 1;
    const item = (await call("POST", "/v1/admin/catalog-items", admin.accessToken, { categoryId, name: `Предмет ${counter}` })).json() as { id: number };
    const created = await call("POST", "/v1/listings", seller.accessToken, body(item.id, price, operation));
    assert.equal(created.statusCode, 201, created.body);
    const listing = created.json() as MyListingDto;
    const published = await call("POST", `/v1/listings/${listing.id}/publish`, seller.accessToken);
    assert.equal(published.statusCode, 200, published.body);
    return { id: listing.id, itemId: item.id };
  };

  const setPrice = async (listing: { id: string; itemId: number }, price: number, operation = "sell") => {
    const response = await call("PUT", `/v1/listings/${listing.id}`, seller.accessToken, body(listing.itemId, price, operation));
    assert.equal(response.statusCode, 200, response.body);
  };

  const notifications = async (user: AuthResponseDto, kind?: string) => {
    const items = ((await call("GET", "/v1/me/notifications", user.accessToken)).json() as { items: NotificationDto[] }).items;
    return kind ? items.filter((n) => n.kind === kind) : items.filter((n) => n.kind.startsWith("favorite_"));
  };

  const favorite = async (user: AuthResponseDto, id: string) => {
    assert.equal((await call("POST", `/v1/listings/${id}/favorite`, user.accessToken)).statusCode, 204);
  };

  before(async () => {
    env = await setupTestEnv();
    admin = await createStaff(env, "admin");
    const types = ((await call("GET", "/v1/admin/listing-types", admin.accessToken)).json() as { items: ListingTypeDto[] }).items;
    itemTypeId = types.find((t) => t.code === "item")!.id;
    categoryId = ((await call("POST", "/v1/admin/categories", admin.accessToken, { sectionCode: "items", name: "Слежение" })).json() as { id: number }).id;
    seller = await registerUser(env);
    await env.database.sql`UPDATE users SET email_verified_at = now() WHERE id = ${seller.user.id}`;
    profile = (await call("POST", "/v1/me/game-profiles", seller.accessToken, { nickname: "Watch_Seller", serverNumber: 3 })).json() as GameProfileDto;
  });
  after(async () => {
    await env.close();
  });

  test("подешевело: порог 1 %, пауза 3 часа, повышение не сообщается", async () => {
    const buyer = await registerUser(env);
    const listing = await publish(10_000_000);
    await favorite(buyer, listing.id);

    await setPrice(listing, 9_950_000);
    assert.equal((await notifications(buyer)).length, 0, "−0,5 % — слишком мало");

    await setPrice(listing, 9_000_000);
    const [first] = await notifications(buyer, "favorite_price");
    assert.ok(first, "о снижении на 10 % сообщили");
    assert.match(first.title, /^Подешевело: /);
    assert.match(first.body, /Было 10.000.000.₽, стало 9.000.000.₽ \(−10%\)/);
    assert.equal(first.link, `/listing/${listing.id}`);

    await setPrice(listing, 9_500_000);
    await setPrice(listing, 8_000_000);
    assert.equal((await notifications(buyer)).length, 1, "повышение не сообщается, а новое снижение ждёт паузу");

    await env.database.sql`UPDATE favorites SET price_notified_at = now() - interval '4 hours' WHERE listing_id = ${listing.id}`;
    await setPrice(listing, 7_900_000);
    const prices = await notifications(buyer, "favorite_price");
    assert.equal(prices.length, 2);
    assert.match(prices[0]!.body, /Было 9.000.000.₽, стало 7.900.000.₽/, "сравнение с последней известной ценой");

    const favorites = ((await call("GET", "/v1/me/favorites", buyer.accessToken)).json() as { items: FavoriteItemDto[] }).items;
    assert.equal(favorites[0]?.addedPrice, 10_000_000, "цена при добавлении сохраняется");
    assert.equal(favorites[0]?.price, 7_900_000);

    const own = await notifications(seller);
    assert.equal(own.length, 0, "владельцу о своём объявлении не сообщаем");
  });

  test("скупка: сообщаем, когда готовы заплатить больше", async () => {
    const buyer = await registerUser(env);
    const listing = await publish(5_000_000, "buy");
    await favorite(buyer, listing.id);
    await setPrice(listing, 4_000_000, "buy");
    assert.equal((await notifications(buyer)).length, 0);
    await setPrice(listing, 6_000_000, "buy");
    const [n] = await notifications(buyer, "favorite_price");
    assert.match(n!.title, /^Скупка дороже: /);
    assert.match(n!.body, /до 6.000.000.₽ вместо 5.000.000.₽ \(\+20%\)/);
  });

  test("снято, снова доступно, повторное снятие в течение 12 часов не сообщается", async () => {
    const buyer = await registerUser(env);
    const listing = await publish(3_000_000);
    await favorite(buyer, listing.id);

    await call("POST", `/v1/listings/${listing.id}/withdraw`, seller.accessToken);
    const [closed] = await notifications(buyer, "favorite_closed");
    assert.match(closed!.title, /^Снято с публикации: /);

    await setPrice(listing, 2_500_000);
    assert.equal((await call("POST", `/v1/listings/${listing.id}/publish`, seller.accessToken)).statusCode, 200);
    const [back] = await notifications(buyer, "favorite_back");
    assert.match(back!.title, /^Снова доступно: /);
    assert.match(back!.body, /Цена 2.500.000.₽ — выгоднее, чем было \(3.000.000.₽\)/);
    assert.equal((await notifications(buyer, "favorite_price")).length, 0, "о цене уже сказано в «снова доступно»");

    await call("POST", `/v1/listings/${listing.id}/withdraw`, seller.accessToken);
    await call("POST", `/v1/listings/${listing.id}/publish`, seller.accessToken);
    assert.equal((await notifications(buyer)).length, 2, "мигание снято/опубликовано не засыпает уведомлениями");

    await env.database.sql`UPDATE favorites SET status_notified_at = now() - interval '13 hours' WHERE listing_id = ${listing.id}`;
    await call("POST", `/v1/listings/${listing.id}/sold`, seller.accessToken);
    const sold = await notifications(buyer, "favorite_closed");
    assert.equal(sold.length, 2);
    assert.match(sold[0]!.title, /^Сделка состоялась: /);
  });

  test("истёк срок — уведомление из архивации", async () => {
    const buyer = await registerUser(env);
    const listing = await publish(1_000_000);
    await favorite(buyer, listing.id);
    await env.database.sql`UPDATE listings SET expires_at = now() - interval '1 minute' WHERE id = ${listing.id}`;
    assert.ok((await archiveExpired(env.database.sql)) >= 1);
    const [n] = await notifications(buyer, "favorite_closed");
    assert.match(n!.title, /^Срок объявления истёк: /);
  });

  test("настройка выключена или продавец в чёрном списке — уведомлений нет", async () => {
    const quiet = await registerUser(env);
    const blocker = await registerUser(env);
    const settings = await call("PATCH", "/v1/me/settings", quiet.accessToken, { notifyFavorites: false });
    assert.equal(settings.statusCode, 200, settings.body);
    const me = settings.json() as MeDto;
    assert.equal(me.notifyFavorites, false);
    assert.equal(me.showOnline, true, "другая настройка не меняется");
    assert.equal((await call("PATCH", "/v1/me/settings", quiet.accessToken, {})).statusCode, 400, "пустой запрос");
    await env.database.sql`INSERT INTO user_blocks (user_id, blocked_id) VALUES (${blocker.user.id}, ${seller.user.id})`;

    const listing = await publish(2_000_000);
    await favorite(quiet, listing.id);
    await favorite(blocker, listing.id);
    await setPrice(listing, 1_000_000);
    await call("POST", `/v1/listings/${listing.id}/withdraw`, seller.accessToken);
    assert.equal((await notifications(quiet)).length, 0);
    assert.equal((await notifications(blocker)).length, 0);

    // Включили снова — старых новостей нет, новые приходят.
    await call("PATCH", "/v1/me/settings", quiet.accessToken, { notifyFavorites: true });
    await call("POST", `/v1/listings/${listing.id}/publish`, seller.accessToken);
    const back = await notifications(quiet, "favorite_back");
    assert.equal(back.length, 1);
    assert.doesNotMatch(back[0]!.body, /выгоднее/, "лучшая цена 1 000 000 уже учтена, хотя уведомление не пришло");
  });
});
