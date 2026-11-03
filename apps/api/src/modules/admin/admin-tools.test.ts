import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AdminListingDto, AdminUserActivityDto, AuthResponseDto, GameProfileDto, ListingTypeDto, MyListingDto, Paged } from "@twm/shared";
import { bearer, createStaff, registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../../test-helpers.js";

describe("админка: поиск объявлений, массовые действия, история игрока", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  let admin: AuthResponseDto;
  let moderator: AuthResponseDto;
  let itemTypeId: number;
  let categoryId: number;

  type Method = "GET" | "POST";
  const call = (method: Method, url: string, token?: string, payload?: unknown) =>
    env.app.inject({ method, url, headers: token ? bearer(token) : {}, ...(payload === undefined ? {} : { payload: payload as object }) });

  const player = async (nickname: string) => {
    const user = await registerUser(env);
    await env.database.sql`UPDATE users SET email_verified_at = now() WHERE id = ${user.user.id}`;
    const profile = (await call("POST", "/v1/me/game-profiles", user.accessToken, { nickname, serverNumber: 9 })).json() as GameProfileDto;
    return { ...user, profile };
  };
  let n = 0;
  const publish = async (owner: { accessToken: string; profile: GameProfileDto }, name: string) => {
    n += 1;
    const item = (await call("POST", "/v1/admin/catalog-items", admin.accessToken, { categoryId, name: `${name} ${n}` })).json() as { id: number };
    const created = await call("POST", "/v1/listings", owner.accessToken, { gameProfileId: owner.profile.id, listingTypeId: itemTypeId, operation: "sell", catalogItemId: item.id, price: 777 });
    assert.equal(created.statusCode, 201, created.body);
    return (await call("POST", `/v1/listings/${(created.json() as MyListingDto).id}/publish`, owner.accessToken)).json() as MyListingDto;
  };
  const search = async (query: string) => {
    const r = await call("GET", `/v1/admin/listings${query}`, moderator.accessToken);
    assert.equal(r.statusCode, 200, r.body);
    return r.json() as Paged<AdminListingDto>;
  };

  before(async () => {
    env = await setupTestEnv();
    admin = await createStaff(env, "admin");
    moderator = await createStaff(env, "moderator");
    const types = ((await call("GET", "/v1/admin/listing-types", admin.accessToken)).json() as { items: ListingTypeDto[] }).items;
    itemTypeId = types.find((t) => t.code === "item")!.id;
    categoryId = ((await call("POST", "/v1/admin/categories", admin.accessToken, { sectionCode: "items", name: "Склад" })).json() as { id: number }).id;
  });
  after(async () => {
    await env.close();
  });

  test("поиск по всем объявлениям и массовые действия", async () => {
    const alice = await player("Alice_Seller");
    const bob = await player("Bob_Seller");
    const a1 = await publish(alice, "Меч");
    const a2 = await publish(alice, "Щит");
    const b1 = await publish(bob, "Меч");

    assert.equal((await call("GET", "/v1/admin/listings", alice.accessToken)).statusCode, 403, "игроку нельзя");
    assert.equal((await search(`?login=${alice.user.login}`)).total, 2);
    assert.deepEqual((await search(`?q=${encodeURIComponent("щит")}`)).items.map((i) => i.id), [a2.id]);
    assert.equal((await search(`?q=${b1.id}`)).items[0]?.author.nickname, "Bob_Seller");

    // Две на проверке — одобряем пачкой.
    await env.database.sql`UPDATE listings SET status = 'moderation' WHERE id IN ${env.database.sql([a1.id, b1.id])}`;
    assert.equal((await search("?status=moderation")).total, 2);
    const approved = await call("POST", "/v1/admin/listings/bulk", moderator.accessToken, { ids: [a1.id, b1.id, a2.id], action: "approve" });
    assert.deepEqual(approved.json(), { done: 2, skipped: 1 }, "активное одобрять не нужно");

    assert.equal((await call("POST", "/v1/admin/listings/bulk", moderator.accessToken, { ids: [a1.id], action: "reject" })).statusCode, 400, "нужна причина");
    const rejected = await call("POST", "/v1/admin/listings/bulk", moderator.accessToken, { ids: [a1.id, a2.id], action: "reject", reason: "Дубли" });
    assert.deepEqual(rejected.json(), { done: 2, skipped: 0 });
    const list = await search(`?login=${alice.user.login}&status=rejected`);
    assert.equal(list.total, 2);
    assert.equal(list.items[0]?.reason, "Дубли");
  });

  test("история игрока: объявления, жалобы, чёрный список, решения модераторов", async () => {
    const suspect = await player("Sus_Player");
    const victim = await player("Victim_Player");
    const listing = await publish(suspect, "Кейс");
    const report = await call("POST", "/v1/reports", victim.accessToken, { targetType: "listing", targetId: listing.id, reason: "scam", comment: "Просит деньги" });
    assert.equal(report.statusCode, 201, report.body);
    await call("POST", `/v1/users/${suspect.user.login}/block`, victim.accessToken);
    await call("POST", `/v1/admin/moderation/listings/${listing.id}/reject`, moderator.accessToken, { reason: "Мошенничество" });

    const r = await call("GET", `/v1/admin/users/${suspect.user.id}/activity`, moderator.accessToken);
    assert.equal(r.statusCode, 200, r.body);
    const activity = r.json() as AdminUserActivityDto;
    assert.equal(activity.stats.listings.rejected, 1);
    assert.equal(activity.stats.reportsAgainst.total, 1);
    assert.equal(activity.stats.reportsAgainst.open, 0, "закрыта вместе с отклонением");
    assert.equal(activity.stats.blockedBy, 1);
    assert.ok(activity.stats.lastSeenAt);
    assert.equal(activity.reportsAgainst[0]?.author, victim.user.login);
    assert.equal(activity.reportsAgainst[0]?.reason, "scam");
    assert.equal(activity.listings[0]?.status, "rejected");
    assert.equal(activity.audit[0]?.action, "listing.rejected");

    const victimView = (await call("GET", `/v1/admin/users/${victim.user.id}/activity`, moderator.accessToken)).json() as AdminUserActivityDto;
    assert.equal(victimView.stats.reportsFiled, 1);
  });
});
