import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type {
  AuthResponseDto,
  ConversationDto,
  GameProfileDto,
  ListingDetailDto,
  ListingSearchResultDto,
  ListingTypeDto,
  MeDto,
  MyListingDto,
  PublicUserDto,
} from "@twm/shared";
import { bearer, createStaff, registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../../test-helpers.js";

describe("поднятие, «в сети», шаблоны ответов, чёрный список", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  let admin: AuthResponseDto;
  let itemTypeId: number;
  let categoryId: number;

  type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  const call = (method: Method, url: string, token?: string, payload?: unknown) =>
    env.app.inject({ method, url, headers: token ? bearer(token) : {}, ...(payload === undefined ? {} : { payload: payload as object }) });

  const player = async (nickname: string) => {
    const user = await registerUser(env);
    await env.database.sql`UPDATE users SET email_verified_at = now() WHERE id = ${user.user.id}`;
    const profile = (await call("POST", "/v1/me/game-profiles", user.accessToken, { nickname, serverNumber: 4 })).json() as GameProfileDto;
    return { ...user, profile };
  };

  let counter = 0;
  const publish = async (owner: { accessToken: string; profile: GameProfileDto }) => {
    counter += 1;
    const item = (await call("POST", "/v1/admin/catalog-items", admin.accessToken, { categoryId, name: `Вещь ${counter}` })).json() as { id: number };
    const created = await call("POST", "/v1/listings", owner.accessToken, {
      gameProfileId: owner.profile.id,
      listingTypeId: itemTypeId,
      operation: "sell",
      catalogItemId: item.id,
      price: 1000 + counter,
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
    categoryId = ((await call("POST", "/v1/admin/categories", admin.accessToken, { sectionCode: "items", name: "Всякое" })).json() as { id: number }).id;
  });
  after(async () => {
    await env.close();
  });

  test("поднятие: раз в сутки, поднятое — первым в «Новых»", async () => {
    const seller = await player("Bump_Seller");
    const older = await publish(seller);
    const newer = await publish(seller);
    assert.ok(older.bumpAvailableAt);

    const early = await call("POST", `/v1/listings/${older.id}/bump`, seller.accessToken);
    assert.equal(early.statusCode, 409);
    assert.equal(early.json().error, "bump_too_early");

    // Как будто опубликовано вчера.
    await env.database.sql`UPDATE listings SET published_at = now() - interval '25 hours' WHERE id = ${older.id}`;
    const bumped = await call("POST", `/v1/listings/${older.id}/bump`, seller.accessToken);
    assert.equal(bumped.statusCode, 200, bumped.body);
    const mine = bumped.json() as MyListingDto;
    assert.ok(mine.bumpedAt);
    assert.ok(new Date(mine.bumpAvailableAt!).getTime() > Date.now() + 23 * 3600 * 1000);

    const list = (await call("GET", "/v1/listings?operation=sell")).json() as ListingSearchResultDto;
    const ids = list.items.map((i) => i.id);
    assert.ok(ids.indexOf(older.id) < ids.indexOf(newer.id), "поднятое выше свежего");
    assert.equal((await call("POST", `/v1/listings/${older.id}/bump`, seller.accessToken)).statusCode, 409, "второй раз за сутки нельзя");
    const stranger = await player("Bump_Stranger");
    assert.equal((await call("POST", `/v1/listings/${older.id}/bump`, stranger.accessToken)).statusCode, 404);
  });

  test("«в сети» видно другим, если не скрыто в настройках", async () => {
    const seller = await player("Online_Seller");
    const listing = await publish(seller);
    const visible = (await call("GET", `/v1/listings/${listing.id}`)).json() as ListingDetailDto;
    assert.ok(visible.seller.lastSeenAt, "только что заходил");
    const profile = (await call("GET", `/v1/users/${seller.user.login}`)).json() as PublicUserDto;
    assert.ok(profile.lastSeenAt);
    assert.equal(profile.blockedByMe, false);

    const settings = await call("PATCH", "/v1/me/settings", seller.accessToken, { showOnline: false });
    assert.equal(settings.statusCode, 200, settings.body);
    assert.equal((settings.json() as MeDto).showOnline, false);
    const hidden = (await call("GET", `/v1/listings/${listing.id}`)).json() as ListingDetailDto;
    assert.equal(hidden.seller.lastSeenAt, null);
    assert.equal(((await call("GET", "/v1/me", seller.accessToken)).json() as MeDto).showOnline, false);
  });

  test("шаблоны ответов: сохраняются списком, с проверкой", async () => {
    const user = await player("Templates_User");
    assert.deepEqual((await call("GET", "/v1/me/chat-templates", user.accessToken)).json(), { items: [] });
    const saved = await call("PUT", "/v1/me/chat-templates", user.accessToken, { items: ["Привет!", "  Жду в игре  "] });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual((await call("GET", "/v1/me/chat-templates", user.accessToken)).json(), { items: ["Привет!", "Жду в игре"] });
    const tooMany = await call("PUT", "/v1/me/chat-templates", user.accessToken, { items: Array.from({ length: 16 }, (_, i) => `t${i}`) });
    assert.equal(tooMany.statusCode, 400);
  });

  test("чёрный список: нельзя начать переписку и писать, отзыв остаётся", async () => {
    const seller = await player("Block_Seller");
    const buyer = await player("Block_Buyer");
    const listing = await publish(seller);
    const conversation = (await call("POST", `/v1/listings/${listing.id}/conversations`, buyer.accessToken)).json() as ConversationDto;
    assert.equal(conversation.blocked, null);
    assert.equal((await call("POST", `/v1/conversations/${conversation.id}/messages`, buyer.accessToken, { body: "Привет" })).statusCode, 201);

    assert.equal((await call("POST", `/v1/users/${buyer.user.login}/block`, seller.accessToken)).statusCode, 204);
    assert.equal((await call("POST", `/v1/users/${seller.user.login}/block`, seller.accessToken)).statusCode, 409, "себя нельзя");

    const fromBuyer = await call("POST", `/v1/conversations/${conversation.id}/messages`, buyer.accessToken, { body: "Ау?" });
    assert.equal(fromBuyer.statusCode, 403);
    assert.equal(fromBuyer.json().error, "chat_blocked");
    assert.equal((await call("POST", `/v1/conversations/${conversation.id}/messages`, seller.accessToken, { body: "Нет" })).statusCode, 403);

    const forBuyer = (await call("GET", `/v1/conversations/${conversation.id}`, buyer.accessToken)).json() as ConversationDto;
    assert.equal(forBuyer.blocked, "by_them");
    const forSeller = (await call("GET", `/v1/conversations/${conversation.id}`, seller.accessToken)).json() as ConversationDto;
    assert.equal(forSeller.blocked, "by_me");

    const other = await publish(seller);
    assert.equal((await call("POST", `/v1/listings/${other.id}/conversations`, buyer.accessToken)).statusCode, 403, "новую не начать");

    const profile = (await call("GET", `/v1/users/${buyer.user.login}`, seller.accessToken)).json() as PublicUserDto;
    assert.equal(profile.blockedByMe, true);
    const blocks = (await call("GET", "/v1/me/blocks", seller.accessToken)).json() as { items: Array<{ login: string }> };
    assert.deepEqual(blocks.items.map((b) => b.login), [buyer.user.login]);

    assert.equal((await call("DELETE", `/v1/users/${buyer.user.login}/block`, seller.accessToken)).statusCode, 204);
    assert.equal((await call("POST", `/v1/conversations/${conversation.id}/messages`, buyer.accessToken, { body: "Снова я" })).statusCode, 201);
  });
});
