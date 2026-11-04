import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AuthResponseDto, ConversationDto, GameProfileDto, ListingTypeDto, MyListingDto, PublicUserDto } from "@twm/shared";
import { bearer, createStaff, registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../test-helpers.js";
import { deleteAccount } from "./account-deletion.js";

describe("удаление аккаунта по просьбе владельца", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  let admin: AuthResponseDto;

  type Method = "GET" | "POST" | "PUT";
  const call = (method: Method, url: string, token?: string, payload?: unknown) =>
    env.app.inject({ method, url, headers: token ? bearer(token) : {}, ...(payload === undefined ? {} : { payload: payload as object }) });

  const player = async (nickname: string) => {
    const user = await registerUser(env);
    await env.database.sql`UPDATE users SET email_verified_at = now() WHERE id = ${user.user.id}`;
    const profile = (await call("POST", "/v1/me/game-profiles", user.accessToken, { nickname, serverNumber: 6 })).json() as GameProfileDto;
    return { ...user, profile };
  };

  before(async () => {
    env = await setupTestEnv();
    admin = await createStaff(env, "admin");
  });
  after(async () => {
    await env.close();
  });

  test("личное удаляется, история собеседника остаётся без логина и email", async () => {
    const sql = env.database.sql;
    const types = ((await call("GET", "/v1/admin/listing-types", admin.accessToken)).json() as { items: ListingTypeDto[] }).items;
    const category = (await call("POST", "/v1/admin/categories", admin.accessToken, { sectionCode: "items", name: "Удаление" })).json() as { id: number };
    const seller = await player("Gone_Seller");
    const buyer = await player("Stay_Buyer");
    const spare = (await call("POST", "/v1/me/game-profiles", seller.accessToken, { nickname: "Gone_Twin", serverNumber: 7 })).json() as GameProfileDto;

    const publish = async (name: string) => {
      const item = (await call("POST", "/v1/admin/catalog-items", admin.accessToken, { categoryId: category.id, name })).json() as { id: number };
      const created = await call("POST", "/v1/listings", seller.accessToken, {
        gameProfileId: seller.profile.id,
        listingTypeId: types.find((t) => t.code === "item")!.id,
        operation: "sell",
        catalogItemId: item.id,
        price: 5000,
        description: "Личное описание",
      });
      assert.equal(created.statusCode, 201, created.body);
      return ((await call("POST", `/v1/listings/${(created.json() as MyListingDto).id}/publish`, seller.accessToken)).json() as MyListingDto).id;
    };
    const sold = await publish("Проданное");
    const lonely = await publish("Без переписки");

    const conversation = (await call("POST", `/v1/listings/${sold}/conversations`, buyer.accessToken)).json() as ConversationDto;
    await call("POST", `/v1/conversations/${conversation.id}/messages`, buyer.accessToken, { body: "Беру" });
    await call("POST", `/v1/conversations/${conversation.id}/messages`, seller.accessToken, { body: "Договорились" });
    await call("POST", `/v1/conversations/${conversation.id}/deal`, buyer.accessToken);
    await call("POST", `/v1/conversations/${conversation.id}/deal/confirm`, seller.accessToken);
    assert.equal((await call("POST", `/v1/conversations/${conversation.id}/review`, seller.accessToken, { positive: true, comment: "Отличный покупатель" })).statusCode, 201);
    await call("POST", `/v1/listings/${sold}/favorite`, buyer.accessToken);
    await call("PUT", "/v1/me/chat-templates", seller.accessToken, { items: ["Привет"] });

    const result = await deleteAccount(sql, seller.user.id, env.dirs);
    assert.equal(result.listingsDeleted, 1);
    assert.equal(result.listingsWithdrawn, 1);
    assert.equal(result.profilesDeleted, 1, "свободный профиль удалён");
    assert.equal(result.profilesKept, 1);

    const [user] = await sql<{ login: string; email: string; status: string }[]>`SELECT login, email, status FROM users WHERE id = ${seller.user.id}`;
    assert.match(user!.login, /^deleted_[0-9a-f]{8}$/);
    assert.match(user!.email, /@deleted\.invalid$/);
    assert.equal(user!.status, "blocked");
    assert.equal((await sql`SELECT 1 FROM listings WHERE id = ${lonely}`).length, 0);
    const [kept] = await sql<{ status: string; description: string }[]>`SELECT status, description FROM listings WHERE id = ${sold}`;
    assert.equal(kept?.status, "withdrawn");
    assert.equal(kept?.description, "");
    assert.equal((await sql`SELECT 1 FROM game_profiles WHERE id = ${spare.id}`).length, 0);
    const [profile] = await sql<{ nickname: string }[]>`SELECT nickname FROM game_profiles WHERE id = ${seller.profile.id}`;
    assert.match(profile!.nickname, /^Deleted_/);
    for (const table of ["sessions", "chat_templates", "notifications", "favorites"]) {
      const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM ${sql(table)} WHERE user_id = ${seller.user.id}`;
      assert.equal(row?.count, 0, table);
    }

    // Старым паролем не войти, сеанс закрыт.
    assert.equal((await call("GET", "/v1/me", seller.accessToken)).statusCode, 401);

    // У покупателя переписка, сделка и отзыв остались, логина продавца в них нет.
    const theirs = (await call("GET", `/v1/conversations/${conversation.id}`, buyer.accessToken)).json() as ConversationDto;
    assert.equal(theirs.deal?.status, "confirmed");
    assert.notEqual(theirs.counterpart.login, seller.user.login);
    const profileOfBuyer = (await call("GET", `/v1/users/${encodeURIComponent(buyer.user.login)}`)).json() as PublicUserDto;
    assert.equal(profileOfBuyer.deals, 1);
    assert.equal(JSON.stringify(profileOfBuyer).includes(seller.user.login), false);
  });
});
