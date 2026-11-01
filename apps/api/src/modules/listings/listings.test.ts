import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type {
  AuthResponseDto,
  GameProfileDto,
  ListingDetailDto,
  ListingSearchResultDto,
  ListingTypeDto,
  MyListingDto,
} from "@twm/shared";
import { archiveExpired } from "./service.js";
import { bearer, createStaff, registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../../test-helpers.js";

/** Минимальный multipart/form-data с одним файлом. */
function multipart(name: string, filename: string, data: Buffer, contentType: string) {
  const boundary = "----twm-test-boundary";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

const png = (width = 640, height = 360, color = "#ffb224") =>
  sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();

describe("объявления", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  let seller: AuthResponseDto;
  let sellerProfile: GameProfileDto;
  let types: ListingTypeDto[];
  let itemId: number;
  let secondItemId: number;
  let clothesItemId: number;
  let carModelId: number;
  let admin: AuthResponseDto;
  let accessoriesId: number;
  let carsCategoryId: number;
  let vehicleTypeId: number;
  let houseTypeId: number;

  const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, token?: string, payload?: unknown) =>
    env.app.inject({
      method,
      url,
      headers: token ? bearer(token) : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  before(async () => {
    env = await setupTestEnv();
    admin = await createStaff(env, "admin");
    types = ((await call("GET", "/v1/admin/listing-types", admin.accessToken)).json() as { items: ListingTypeDto[] }).items;
    vehicleTypeId = types.find((t) => t.code === "vehicle")!.id;
    houseTypeId = types.find((t) => t.code === "house")!.id;

    const category = (await call("POST", "/v1/admin/categories", admin.accessToken, { sectionCode: "items", name: "Аксессуары" })).json() as { id: number };
    accessoriesId = category.id;
    itemId = ((await call("POST", "/v1/admin/catalog-items", admin.accessToken, { categoryId: category.id, name: "Наручные часы", aliases: ["часики"] })).json() as { id: number }).id;
    secondItemId = ((await call("POST", "/v1/admin/catalog-items", admin.accessToken, { categoryId: category.id, name: "Наручные часы" })).json() as { id: number }).id;
    const clothes = (await call("POST", "/v1/admin/categories", admin.accessToken, { sectionCode: "items", name: "Одежда" })).json() as { id: number };
    clothesItemId = ((await call("POST", "/v1/admin/catalog-items", admin.accessToken, { categoryId: clothes.id, name: "Кожаная куртка" })).json() as { id: number }).id;
    const cars = (await call("POST", "/v1/admin/categories", admin.accessToken, { sectionCode: "cars", name: "Легковые" })).json() as { id: number };
    carsCategoryId = cars.id;
    carModelId = ((await call("POST", "/v1/admin/catalog-items", admin.accessToken, { categoryId: cars.id, name: "BMW M5 F90", aliases: ["БМВ M5 F90"] })).json() as { id: number }).id;

    // Улучшение — у аксессуаров и одежды, целостность (шаг 5 для проверки) — только у одежды.
    const upgrade = await call("POST", "/v1/admin/attributes", admin.accessToken, {
      listingTypeId: types.find((t) => t.code === "item")!.id,
      key: "upgrade",
      label: "Улучшение",
      dataType: "number",
      unit: "X{}",
      minValue: 1,
      maxValue: 15,
      stepValue: 1,
      categoryIds: [category.id, clothes.id],
      filterable: true,
    });
    assert.equal(upgrade.statusCode, 201, upgrade.body);
    const wear = await call("POST", "/v1/admin/attributes", admin.accessToken, {
      listingTypeId: types.find((t) => t.code === "item")!.id,
      key: "integrity",
      label: "Целостность",
      dataType: "number",
      unit: "%",
      minValue: 0,
      maxValue: 100,
      stepValue: 5,
      categoryIds: [clothes.id],
    });
    assert.equal(wear.statusCode, 201, wear.body);

    await call("POST", "/v1/admin/attributes", admin.accessToken, {
      listingTypeId: vehicleTypeId,
      key: "max_speed",
      label: "Максимальная скорость",
      dataType: "number",
      unit: "км/ч",
      minValue: 0,
      maxValue: 500,
      filterable: true,
      required: true,
    });
    await call("POST", "/v1/admin/attributes", admin.accessToken, {
      listingTypeId: houseTypeId,
      key: "garage",
      label: "Гараж",
      dataType: "boolean",
      appliesTo: "both",
    });

    seller = await registerUser(env, { login: "seller_one" });
    await env.database.sql`UPDATE users SET email_verified_at = now() WHERE id = ${seller.user.id}`;
    sellerProfile = (await call("POST", "/v1/me/game-profiles", seller.accessToken, { nickname: "Max_Volkov", serverNumber: 8 })).json() as GameProfileDto;
  });
  after(async () => {
    await env.close();
  });

  const itemListing = (overrides: Record<string, unknown> = {}) => ({
    gameProfileId: sellerProfile.id,
    listingTypeId: types.find((t) => t.code === "item")!.id,
    operation: "sell",
    catalogItemId: itemId,
    price: 2_350_000,
    quantity: 2,
    description: "Отдам быстро, на сервере вечером",
    ...overrides,
  });

  /** Новая позиция справочника: одинаковое активное объявление дважды не публикуется. */
  const newCatalogItem = async (categoryId: number, name: string) =>
    ((await call("POST", "/v1/admin/catalog-items", admin.accessToken, { categoryId, name })).json() as { id: number }).id;

  const createAndPublish = async (body: Record<string, unknown>, token = seller.accessToken) => {
    const created = await call("POST", "/v1/listings", token, body);
    assert.equal(created.statusCode, 201, created.body);
    const id = (created.json() as MyListingDto).id;
    const published = await call("POST", `/v1/listings/${id}/publish`, token);
    assert.equal(published.statusCode, 200, published.body);
    return published.json() as MyListingDto;
  };

  test("предмет: название из справочника, черновик, публикация, срок 14 дней", async () => {
    const created = await call("POST", "/v1/listings", seller.accessToken, itemListing());
    assert.equal(created.statusCode, 201, created.body);
    const draft = created.json() as MyListingDto;
    assert.equal(draft.status, "draft");
    assert.equal(draft.title, "Наручные часы");
    assert.equal(draft.server.name, "SKY");
    assert.equal(draft.price, 2_350_000);

    // Черновик не виден в каталоге и чужим.
    const stranger = await registerUser(env);
    assert.equal((await call("GET", `/v1/listings/${draft.id}`, stranger.accessToken)).statusCode, 404);

    const published = (await call("POST", `/v1/listings/${draft.id}/publish`, seller.accessToken)).json() as MyListingDto;
    assert.equal(published.status, "active");
    const days = (new Date(published.expiresAt!).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 13.9 && days <= 14.01);
  });

  test("без подтверждённого email опубликовать нельзя", async () => {
    const newbie = await registerUser(env);
    const profile = (await call("POST", "/v1/me/game-profiles", newbie.accessToken, { nickname: "Newbie_One", serverNumber: 8 })).json() as GameProfileDto;
    const draft = (await call("POST", "/v1/listings", newbie.accessToken, itemListing({ gameProfileId: profile.id }))).json() as MyListingDto;
    const publish = await call("POST", `/v1/listings/${draft.id}/publish`, newbie.accessToken);
    assert.equal(publish.statusCode, 403);
    assert.equal(publish.json().error, "email_not_verified");
  });

  test("проверки: чужой профиль, предмет обязателен, операция типа, цена", async () => {
    const other = await registerUser(env);
    const foreign = await call("POST", "/v1/listings", other.accessToken, itemListing());
    assert.equal(foreign.statusCode, 400);
    assert.ok(foreign.json().fields.gameProfileId);

    const noItem = await call("POST", "/v1/listings", seller.accessToken, itemListing({ catalogItemId: null, title: "Часы" }));
    assert.equal(noItem.statusCode, 400);
    assert.ok(noItem.json().fields.catalogItemId);

    const exchangeItem = await call("POST", "/v1/listings", seller.accessToken, itemListing({ operation: "exchange", wantDescription: "что-нибудь" }));
    assert.equal(exchangeItem.statusCode, 400, "у предметов нет обмена");
    assert.ok(exchangeItem.json().fields.operation);

    const noPrice = await call("POST", "/v1/listings", seller.accessToken, itemListing({ price: null }));
    assert.equal(noPrice.statusCode, 400);
    assert.ok(noPrice.json().fields.price);
  });

  test("характеристики проверяются по конструктору, фильтр по ним работает", async () => {
    const base = {
      gameProfileId: sellerProfile.id,
      listingTypeId: vehicleTypeId,
      operation: "sell",
      catalogItemId: await newCatalogItem(carsCategoryId, "Lada Priora"),
      title: "Седан Тест",
      price: 18_200_000,
      dealPlaces: ["car_market", "notary", "car_market"],
    };
    const missing = await call("POST", "/v1/listings", seller.accessToken, { ...base, attributes: {} });
    assert.equal(missing.statusCode, 400);
    assert.ok(missing.json().fields["attributes.max_speed"]);

    const tooFast = await call("POST", "/v1/listings", seller.accessToken, { ...base, attributes: { max_speed: 900 } });
    assert.equal(tooFast.statusCode, 400);

    const fast = await createAndPublish({ ...base, attributes: { max_speed: 240, hacked: "x" } });
    assert.deepEqual(fast.rawAttributes, { max_speed: 240 }, "лишние поля отброшены");
    assert.deepEqual(fast.dealPlaces, ["car_market", "notary"]);
    assert.equal(fast.attributes[0]?.label, "Максимальная скорость");
    assert.equal(fast.attributes[0]?.unit, "км/ч");

    await createAndPublish({
      ...base,
      catalogItemId: await newCatalogItem(carsCategoryId, "Lada Granta"),
      title: "Медленный седан",
      attributes: { max_speed: 120 },
    });

    const filtered = (await call("GET", `/v1/listings?type=${vehicleTypeId}&a.max_speed.min=200`)).json() as ListingSearchResultDto;
    assert.deepEqual(filtered.items.map((i) => i.title), ["Седан Тест"]);
  });

  test("транспорт: модель из справочника обязательна, название по умолчанию — модель", async () => {
    const base = {
      gameProfileId: sellerProfile.id,
      listingTypeId: vehicleTypeId,
      operation: "sell",
      price: 12_000_000,
      attributes: { max_speed: 250 },
    };
    const noModel = await call("POST", "/v1/listings", seller.accessToken, { ...base, title: "Какая-то машина" });
    assert.equal(noModel.statusCode, 400);
    assert.match(noModel.json().fields.catalogItemId, /модель/i);

    const wrongSection = await call("POST", "/v1/listings", seller.accessToken, { ...base, catalogItemId: itemId });
    assert.equal(wrongSection.statusCode, 400, "предмет рынка не подходит как модель авто");

    const created = await call("POST", "/v1/listings", seller.accessToken, { ...base, catalogItemId: carModelId });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal((created.json() as MyListingDto).title, "BMW M5 F90");

    const models = (await call("GET", "/v1/catalog/items?section=cars")).json() as { items: Array<{ name: string }> };
    const names = models.items.map((i) => i.name);
    assert.ok(names.includes("BMW M5 F90"));
    assert.ok(!names.includes("Наручные часы"), "только модели авторынка");
  });

  test("поля по категориям и шаг значения", async () => {
    const watch = await createAndPublish(
      itemListing({ catalogItemId: await newCatalogItem(accessoriesId, "Белая борода"), attributes: { upgrade: 12, integrity: 50 } }),
    );
    assert.deepEqual(watch.rawAttributes, { upgrade: 12 }, "у аксессуара нет целостности — поле отброшено");
    assert.equal(watch.attributes[0]?.unit, "X{}");

    const badStep = await call("POST", "/v1/listings", seller.accessToken, itemListing({ catalogItemId: clothesItemId, attributes: { integrity: 52 } }));
    assert.equal(badStep.statusCode, 400);
    assert.ok(badStep.json().fields["attributes.integrity"]);

    const tooHigh = await call("POST", "/v1/listings", seller.accessToken, itemListing({ catalogItemId: clothesItemId, attributes: { upgrade: 16 } }));
    assert.equal(tooHigh.statusCode, 400, "улучшение не больше X15");

    const jacket = await createAndPublish(itemListing({ catalogItemId: clothesItemId, attributes: { upgrade: 15, integrity: 55 } }));
    assert.deepEqual(jacket.rawAttributes, { upgrade: 15, integrity: 55 });

    const maxed = (await call("GET", `/v1/listings?type=${watch.listingType.id}&a.upgrade.min=15`)).json() as ListingSearchResultDto;
    assert.deepEqual(maxed.items.map((i) => i.id), [jacket.id]);
  });

  test("обмен: что хочу получить, доплата; лишнее для продажи очищается", async () => {
    const exchange = await createAndPublish({
      gameProfileId: sellerProfile.id,
      listingTypeId: houseTypeId,
      operation: "exchange",
      title: "Дом у моря",
      attributes: { garage: true },
      wantListingTypeId: houseTypeId,
      wantAttributes: { garage: false },
      wantDescription: "Дом ближе к центру",
      surcharge: 5_000_000,
      surchargeDirection: "i_pay",
    });
    assert.equal(exchange.price, null);
    assert.equal(exchange.want?.surcharge, 5_000_000);
    assert.equal(exchange.want?.surchargeDirection, "i_pay");
    assert.equal(exchange.want?.listingType?.name, "Дом");
    assert.equal(exchange.want?.attributes[0]?.value, false);

    const noWant = await call("POST", "/v1/listings", seller.accessToken, {
      gameProfileId: sellerProfile.id,
      listingTypeId: houseTypeId,
      operation: "exchange",
      title: "Дом без пожеланий",
    });
    assert.equal(noWant.statusCode, 400);
    assert.ok(noWant.json().fields.wantDescription);
  });

  test("дубль активного объявления не публикуется; одинаковые названия разных предметов — можно", async () => {
    const dupSeller = await registerUser(env, { login: "dup_seller" });
    await env.database.sql`UPDATE users SET email_verified_at = now() WHERE id = ${dupSeller.user.id}`;
    const profile = (await call("POST", "/v1/me/game-profiles", dupSeller.accessToken, { nickname: "Dup_Seller", serverNumber: 8 })).json() as GameProfileDto;

    await createAndPublish(itemListing({ gameProfileId: profile.id }), dupSeller.accessToken);
    const second = (await call("POST", "/v1/listings", dupSeller.accessToken, itemListing({ gameProfileId: profile.id }))).json() as MyListingDto;
    const publish = await call("POST", `/v1/listings/${second.id}/publish`, dupSeller.accessToken);
    assert.equal(publish.statusCode, 409);
    assert.equal(publish.json().error, "duplicate_listing");

    // Другой предмет с таким же названием — не дубль.
    const sameName = await createAndPublish(itemListing({ gameProfileId: profile.id, catalogItemId: secondItemId }), dupSeller.accessToken);
    assert.equal(sameName.title, "Наручные часы");
  });

  test("поиск: по названию, синониму, нику, серверу, цене и сортировка", async () => {
    const searcher = await registerUser(env);
    const byTitle = (await call("GET", `/v1/listings?q=${encodeURIComponent("часы")}&section=items`, searcher.accessToken)).json() as ListingSearchResultDto;
    assert.ok(byTitle.total >= 1);
    assert.ok(byTitle.items.every((i) => i.sectionCode === "items"));

    const byAlias = (await call("GET", `/v1/listings?q=${encodeURIComponent("часики")}`)).json() as ListingSearchResultDto;
    assert.ok(byAlias.total >= 1, "поиск по синониму из справочника");

    const byNick = (await call("GET", `/v1/listings?nick=max_vol`)).json() as ListingSearchResultDto;
    assert.ok(byNick.items.length >= 1 && byNick.items.every((i) => i.sellerNickname === "Max_Volkov"));

    const otherServer = (await call("GET", `/v1/listings?server=1`)).json() as ListingSearchResultDto;
    assert.equal(otherServer.total, 0);

    const cheap = (await call("GET", `/v1/listings?priceMax=3000000`)).json() as ListingSearchResultDto;
    assert.ok(cheap.items.every((i) => (i.price ?? 0) <= 3_000_000));

    const sorted = (await call("GET", `/v1/listings?sort=price_desc&operation=sell`)).json() as ListingSearchResultDto;
    const prices = sorted.items.map((i) => i.price ?? 0);
    assert.deepEqual(prices, [...prices].sort((a, b) => b - a));
  });

  test("перевод между серверами: с флагом видны объявления с других серверов", async () => {
    const mover = await registerUser(env);
    await env.database.sql`UPDATE users SET email_verified_at = now() WHERE id = ${mover.user.id}`;
    const red = (await call("POST", "/v1/me/game-profiles", mover.accessToken, { nickname: "Red_Mover", serverNumber: 1 })).json() as GameProfileDto;
    await createAndPublish(itemListing({ gameProfileId: red.id, transferMode: "seller_moves" }), mover.accessToken);

    const skyOnly = (await call("GET", `/v1/listings?server=8&nick=red_mover`)).json() as ListingSearchResultDto;
    assert.equal(skyOnly.total, 0);
    const withTransfer = (await call("GET", `/v1/listings?server=8&transfer=1&nick=red_mover`)).json() as ListingSearchResultDto;
    assert.equal(withTransfer.total, 1);
  });

  test("фото: загрузка, превью, главное, порядок, удаление; не картинка отклоняется", async () => {
    const listing = await createAndPublish({
      gameProfileId: sellerProfile.id,
      listingTypeId: vehicleTypeId,
      operation: "sell",
      catalogItemId: await newCatalogItem(carsCategoryId, "Купе с фото"),
      title: "Купе с фото",
      price: 21_000_000,
      attributes: { max_speed: 300 },
    });
    const upload = async (data: Buffer, type = "image/png") => {
      const body = multipart("file", "shot.png", data, type);
      return env.app.inject({ method: "POST", url: `/v1/listings/${listing.id}/images`, headers: { ...bearer(seller.accessToken), ...body.headers }, payload: body.payload });
    };

    const first = await upload(await png());
    assert.equal(first.statusCode, 201, first.body);
    const second = await upload(await png(800, 600, "#3366ff"));
    const images = (second.json() as { images: ListingDetailDto["images"] }).images;
    assert.equal(images.length, 2);
    assert.equal(images[0]?.isMain, true, "первое фото — главное");
    assert.match(images[0]!.thumbUrl, /^\/media\/listings\/.+-thumb\.webp$/);

    const thumb = await env.app.inject({ method: "GET", url: images[0]!.thumbUrl });
    assert.equal(thumb.statusCode, 200);
    const meta = await sharp(thumb.rawPayload).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, 480);

    const reorder = await call("PUT", `/v1/listings/${listing.id}/images`, seller.accessToken, {
      order: [images[1]!.id, images[0]!.id],
      mainId: images[1]!.id,
    });
    const reordered = (reorder.json() as { images: ListingDetailDto["images"] }).images;
    assert.equal(reordered[0]?.id, images[1]!.id);
    assert.equal(reordered[0]?.isMain, true);

    const card = (await call("GET", `/v1/listings?q=${encodeURIComponent("Купе с фото")}`)).json() as ListingSearchResultDto;
    assert.equal(card.items[0]?.image?.url, reordered[0]!.thumbUrl, "в каталоге — главное фото");

    const notImage = await upload(Buffer.from("MZ this is not an image at all"), "image/png");
    assert.equal(notImage.statusCode, 400);
    assert.equal(notImage.json().error, "invalid_image");

    const tiny = await upload(await png(50, 50));
    assert.equal(tiny.statusCode, 400);

    const removed = await call("DELETE", `/v1/listings/${listing.id}/images/${images[1]!.id}`, seller.accessToken);
    const left = (removed.json() as { images: ListingDetailDto["images"] }).images;
    assert.equal(left.length, 1);
    assert.equal(left[0]?.isMain, true, "после удаления главного главным становится оставшееся");

    const stranger = await registerUser(env);
    const body = multipart("file", "x.png", await png(), "image/png");
    const foreign = await env.app.inject({ method: "POST", url: `/v1/listings/${listing.id}/images`, headers: { ...bearer(stranger.accessToken), ...body.headers }, payload: body.payload });
    assert.equal(foreign.statusCode, 404);
  });

  test("карточка: просмотры не считают владельца, продавец и предупреждение о нике", async () => {
    const listing = await createAndPublish(itemListing({ catalogItemId: secondItemId, price: 1_000_000 }));
    const twin = await registerUser(env);
    await call("POST", "/v1/me/game-profiles", twin.accessToken, { nickname: "max_volkov", serverNumber: 8 });

    await call("GET", `/v1/listings/${listing.id}`, seller.accessToken);
    const viewed = (await call("GET", `/v1/listings/${listing.id}`, twin.accessToken)).json() as ListingDetailDto;
    assert.equal(viewed.views, 1);
    assert.equal(viewed.isOwner, false);
    assert.equal(viewed.seller.login, "seller_one");
    assert.equal(viewed.seller.nickname, "Max_Volkov");
    assert.equal(viewed.seller.sameNicknameCount, 1);
  });

  test("избранное, снятие, продано, удаление черновика, архив по сроку", async () => {
    const buyer = await registerUser(env);
    const listing = await createAndPublish({
      gameProfileId: sellerProfile.id,
      listingTypeId: vehicleTypeId,
      operation: "sell",
      catalogItemId: await newCatalogItem(carsCategoryId, "Машина для избранного"),
      title: "Машина для избранного",
      price: 5_000_000,
      attributes: { max_speed: 180 },
    });
    assert.equal((await call("POST", `/v1/listings/${listing.id}/favorite`, buyer.accessToken)).statusCode, 204);
    const favs = (await call("GET", "/v1/me/favorites", buyer.accessToken)).json() as { items: Array<{ id: string; favorite: boolean }> };
    assert.equal(favs.items[0]?.id, listing.id);
    assert.equal(favs.items[0]?.favorite, true);

    const withdrawn = (await call("POST", `/v1/listings/${listing.id}/withdraw`, seller.accessToken)).json() as MyListingDto;
    assert.equal(withdrawn.status, "withdrawn");
    assert.equal((await call("GET", `/v1/listings/${listing.id}`, buyer.accessToken)).statusCode, 404);
    assert.equal((await call("DELETE", `/v1/listings/${listing.id}`, seller.accessToken)).statusCode, 409, "опубликованное не удаляется");

    const republished = (await call("POST", `/v1/listings/${listing.id}/publish`, seller.accessToken)).json() as MyListingDto;
    assert.equal(republished.status, "active");
    const sold = (await call("POST", `/v1/listings/${listing.id}/sold`, seller.accessToken)).json() as MyListingDto;
    assert.equal(sold.status, "sold");
    assert.equal((await call("PUT", `/v1/listings/${listing.id}`, seller.accessToken, itemListing())).statusCode, 409);

    const draft = (await call("POST", "/v1/listings", seller.accessToken, itemListing({ price: 1 }))).json() as MyListingDto;
    assert.equal((await call("DELETE", `/v1/listings/${draft.id}`, seller.accessToken)).statusCode, 204);

    const expiring = await createAndPublish({
      gameProfileId: sellerProfile.id,
      listingTypeId: vehicleTypeId,
      operation: "sell",
      catalogItemId: await newCatalogItem(carsCategoryId, "Скоро в архив"),
      title: "Скоро в архив",
      price: 7_000_000,
      attributes: { max_speed: 150 },
    });
    await env.database.sql`UPDATE listings SET expires_at = now() - interval '1 minute' WHERE id = ${expiring.id}`;
    assert.ok((await archiveExpired(env.database.sql)) >= 1);
    const mine = (await call("GET", "/v1/me/listings?status=archived", seller.accessToken)).json() as { items: Array<{ id: string }> };
    assert.ok(mine.items.some((i) => i.id === expiring.id));
  });

  test("профиль с объявлениями не удаляется, а скрывается; объявления снимаются", async () => {
    const owner = await registerUser(env);
    await env.database.sql`UPDATE users SET email_verified_at = now() WHERE id = ${owner.user.id}`;
    const profile = (await call("POST", "/v1/me/game-profiles", owner.accessToken, { nickname: "Temp_Nick", serverNumber: 8 })).json() as GameProfileDto;
    const listing = await createAndPublish(itemListing({ gameProfileId: profile.id }), owner.accessToken);

    assert.equal((await call("DELETE", `/v1/me/game-profiles/${profile.id}`, owner.accessToken)).statusCode, 204);
    const profiles = (await call("GET", "/v1/me/game-profiles", owner.accessToken)).json() as { items: unknown[] };
    assert.equal(profiles.items.length, 0);
    const mine = (await call("GET", `/v1/me/listings/${listing.id}`, owner.accessToken)).json() as MyListingDto;
    assert.equal(mine.status, "withdrawn");

    const restored = await call("POST", "/v1/me/game-profiles", owner.accessToken, { nickname: "Temp_Nick", serverNumber: 8 });
    assert.equal(restored.statusCode, 201);
    assert.equal((restored.json() as GameProfileDto).id, profile.id, "тот же профиль вернулся из архива");
  });

  test("иконки предметов: картинка и WebM; справочник для формы", async () => {
    const admin = await createStaff(env, "admin");
    const body = multipart("file", "icon.png", await png(300, 300), "image/png");
    const uploaded = await env.app.inject({ method: "POST", url: `/v1/admin/catalog-items/${itemId}/icon`, headers: { ...bearer(admin.accessToken), ...body.headers }, payload: body.payload });
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    assert.equal(uploaded.json().icon.kind, "image");

    // Заголовок EBML + «webm» — минимальный признак видео WebM.
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("....B\x82\x84webm"), Buffer.alloc(200)]);
    const video = multipart("file", "icon.webm", webm, "video/webm");
    const uploadedVideo = await env.app.inject({ method: "POST", url: `/v1/admin/catalog-items/${secondItemId}/icon`, headers: { ...bearer(admin.accessToken), ...video.headers }, payload: video.payload });
    assert.equal(uploadedVideo.statusCode, 200, uploadedVideo.body);
    assert.equal(uploadedVideo.json().icon.kind, "video");

    const options = (await call("GET", `/v1/catalog/items?q=${encodeURIComponent("часы")}`)).json() as { items: Array<{ id: number; icon: { kind: string } | null }> };
    assert.equal(options.items.length, 2, "два предмета с одинаковым названием");
    assert.ok(options.items.every((i) => i.icon !== null));
  });
});
