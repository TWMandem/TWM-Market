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
  NicknameVerificationDto,
  NotificationDto,
  PublicUserDto,
  VerificationQueueItemDto,
} from "@twm/shared";
import { bearer, createStaff, registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../../test-helpers.js";

function multipart(data: Buffer) {
  const boundary = "----twm-verify";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="stats.png"\r\nContent-Type: image/png\r\n\r\n`);
  return { payload: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe("подтверждение ника и предупреждения покупателю", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  let admin: AuthResponseDto;
  let itemTypeId: number;
  let categoryId: number;

  type Method = "GET" | "POST" | "PATCH";
  const call = (method: Method, url: string, token?: string, payload?: unknown) =>
    env.app.inject({ method, url, headers: token ? bearer(token) : {}, ...(payload === undefined ? {} : { payload: payload as object }) });

  const player = async (nickname: string) => {
    const user = await registerUser(env);
    await env.database.sql`UPDATE users SET email_verified_at = now() WHERE id = ${user.user.id}`;
    const profile = (await call("POST", "/v1/me/game-profiles", user.accessToken, { nickname, serverNumber: 6 })).json() as GameProfileDto;
    return { ...user, profile };
  };
  const upload = async (token: string, profileId: string) => {
    const png = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#203040" } }).png().toBuffer();
    const form = multipart(png);
    return env.app.inject({ method: "POST", url: `/v1/me/game-profiles/${profileId}/verification`, headers: { ...bearer(token), ...form.headers }, payload: form.payload });
  };
  const publish = async (owner: { accessToken: string; profile: GameProfileDto }, itemId: number, price: number) => {
    const created = await call("POST", "/v1/listings", owner.accessToken, { gameProfileId: owner.profile.id, listingTypeId: itemTypeId, operation: "sell", catalogItemId: itemId, price });
    assert.equal(created.statusCode, 201, created.body);
    const published = await call("POST", `/v1/listings/${(created.json() as MyListingDto).id}/publish`, owner.accessToken);
    assert.equal(published.statusCode, 200, published.body);
    return published.json() as MyListingDto;
  };
  let itemCounter = 0;
  const newItem = async () => {
    itemCounter += 1;
    return ((await call("POST", "/v1/admin/catalog-items", admin.accessToken, { categoryId, name: `Штука ${itemCounter}` })).json() as { id: number }).id;
  };

  before(async () => {
    env = await setupTestEnv();
    admin = await createStaff(env, "admin");
    const types = ((await call("GET", "/v1/admin/listing-types", admin.accessToken)).json() as { items: ListingTypeDto[] }).items;
    itemTypeId = types.find((t) => t.code === "item")!.id;
    categoryId = ((await call("POST", "/v1/admin/categories", admin.accessToken, { sectionCode: "items", name: "Прочее" })).json() as { id: number }).id;
  });
  after(async () => {
    await env.close();
  });

  test("подтверждение ника: код, скриншот, очередь, одобрение", async () => {
    const seller = await player("Verify_Me");
    const first = (await call("GET", `/v1/me/game-profiles/${seller.profile.id}/verification`, seller.accessToken)).json() as NicknameVerificationDto;
    assert.equal(first.status, "draft");
    assert.match(first.code ?? "", /^TWM-[A-Z2-9]{6}$/);
    const again = (await call("GET", `/v1/me/game-profiles/${seller.profile.id}/verification`, seller.accessToken)).json() as NicknameVerificationDto;
    assert.equal(again.code, first.code, "код не меняется, пока заявка открыта");

    const sent = await upload(seller.accessToken, seller.profile.id);
    assert.equal(sent.statusCode, 200, sent.body);
    assert.equal((sent.json() as NicknameVerificationDto).status, "pending");

    const queue = (await call("GET", "/v1/admin/verifications", admin.accessToken)).json() as { items: VerificationQueueItemDto[] };
    const item = queue.items.find((i) => i.nickname === "Verify_Me");
    assert.ok(item);
    assert.equal(item.code, first.code);

    const image = await call("GET", `/v1/admin/verifications/${item.id}/image`, admin.accessToken);
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers["content-type"], "image/webp");
    assert.equal((await call("GET", `/v1/admin/verifications/${item.id}/image`, seller.accessToken)).statusCode, 403, "игроку нельзя");
    // Закрытые файлы не раздаются по /media.
    assert.notEqual((await call("GET", "/media/verifications/")).statusCode, 200);

    assert.equal((await call("POST", `/v1/admin/verifications/${item.id}/approve`, admin.accessToken)).statusCode, 200);
    const profiles = (await call("GET", "/v1/me/game-profiles", seller.accessToken)).json() as { items: GameProfileDto[] };
    assert.equal(profiles.items[0]?.verified, true);
    assert.equal(((await call("GET", `/v1/me/game-profiles/${seller.profile.id}/verification`, seller.accessToken)).json() as NicknameVerificationDto).status, "verified");
    const notes = (await call("GET", "/v1/me/notifications", seller.accessToken)).json() as { items: NotificationDto[] };
    assert.equal(notes.items[0]?.kind, "nickname_verified");

    const listing = await publish(seller, await newItem(), 5000);
    const card = ((await call("GET", `/v1/listings?item=${listing.catalogItem?.id ?? 0}`)).json() as ListingSearchResultDto).items[0];
    assert.equal(card?.sellerVerified, true);
    const user = (await call("GET", `/v1/users/${seller.user.login}`)).json() as PublicUserDto;
    assert.deepEqual(user.verifiedNicknames.map((v) => v.nickname), ["Verify_Me"]);

    // Смена ника снимает подтверждение.
    await call("PATCH", `/v1/me/game-profiles/${seller.profile.id}`, seller.accessToken, { nickname: "Verify_Other" });
    const renamed = (await call("GET", "/v1/me/game-profiles", seller.accessToken)).json() as { items: GameProfileDto[] };
    assert.equal(renamed.items[0]?.verified, false);
  });

  test("отказ в подтверждении: причина видна игроку", async () => {
    const seller = await player("Verify_Rejected");
    await call("GET", `/v1/me/game-profiles/${seller.profile.id}/verification`, seller.accessToken);
    assert.equal((await upload(seller.accessToken, seller.profile.id)).statusCode, 200);
    const queue = (await call("GET", "/v1/admin/verifications", admin.accessToken)).json() as { items: VerificationQueueItemDto[] };
    const item = queue.items.find((i) => i.nickname === "Verify_Rejected")!;
    assert.equal((await call("POST", `/v1/admin/verifications/${item.id}/reject`, admin.accessToken, { reason: "Ник не виден" })).statusCode, 200);
    const next = (await call("GET", `/v1/me/game-profiles/${seller.profile.id}/verification`, seller.accessToken)).json() as NicknameVerificationDto;
    assert.equal(next.status, "draft");
    assert.equal(next.rejectReason, "Ник не виден");
    assert.notEqual(next.code, item.code, "новый код");
  });

  test("предупреждения: слишком низкая цена, новый аккаунт; автору не показываются", async () => {
    const others = await player("Price_Others");
    const item = await newItem();
    // У одного игрока одно объявление на предмет — берём трёх продавцов.
    await publish(others, item, 1000);
    await publish(await player("Price_Two"), item, 1100);
    await publish(await player("Price_Three"), item, 900);
    const cheap = await player("Too_Cheap");
    const listing = await publish(cheap, item, 300);

    const buyer = await player("Careful_Buyer");
    const detail = (await call("GET", `/v1/listings/${listing.id}`, buyer.accessToken)).json() as ListingDetailDto;
    assert.ok(detail.warnings.some((w) => w.startsWith("Цена более чем вдвое ниже")), detail.warnings.join("; "));
    assert.ok(detail.warnings.includes("Аккаунт продавца создан сегодня."));
    assert.equal(detail.seller.trusted, false);
    const own = (await call("GET", `/v1/listings/${listing.id}`, cheap.accessToken)).json() as ListingDetailDto;
    assert.deepEqual(own.warnings, []);
  });
});
