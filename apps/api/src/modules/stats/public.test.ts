import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AuthResponseDto, GameProfileDto, ListingTypeDto, MyListingDto, PublicStatsDto } from "@twm/shared";
import { bearer, createStaff, registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../../test-helpers.js";

describe("цифры площадки для сайта", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  let admin: AuthResponseDto;

  const call = (method: "GET" | "POST", url: string, token?: string, payload?: unknown) =>
    env.app.inject({ method, url, headers: token ? bearer(token) : {}, ...(payload === undefined ? {} : { payload: payload as object }) });

  before(async () => {
    env = await setupTestEnv();
    admin = await createStaff(env, "admin");
  });
  after(async () => {
    await env.close();
  });

  test("считает активные объявления по разделам и продавцов, без входа", async () => {
    const types = ((await call("GET", "/v1/admin/listing-types", admin.accessToken)).json() as { items: ListingTypeDto[] }).items;
    const category = (await call("POST", "/v1/admin/categories", admin.accessToken, { sectionCode: "items", name: "Для сайта" })).json() as { id: number };
    const seller = await registerUser(env);
    await env.database.sql`UPDATE users SET email_verified_at = now() WHERE id = ${seller.user.id}`;
    const profile = (await call("POST", "/v1/me/game-profiles", seller.accessToken, { nickname: "Site_Seller", serverNumber: 2 })).json() as GameProfileDto;
    for (const name of ["Шляпа", "Очки"]) {
      const item = (await call("POST", "/v1/admin/catalog-items", admin.accessToken, { categoryId: category.id, name })).json() as { id: number };
      const created = await call("POST", "/v1/listings", seller.accessToken, {
        gameProfileId: profile.id,
        listingTypeId: types.find((t) => t.code === "item")!.id,
        operation: "sell",
        catalogItemId: item.id,
        price: 1000,
      });
      assert.equal(created.statusCode, 201, created.body);
      const published = await call("POST", `/v1/listings/${(created.json() as MyListingDto).id}/publish`, seller.accessToken);
      assert.equal(published.statusCode, 200, published.body);
    }

    const response = await call("GET", "/v1/public/stats");
    assert.equal(response.statusCode, 200, response.body);
    assert.match(String(response.headers["cache-control"]), /max-age=300/);
    const stats = response.json() as PublicStatsDto;
    assert.ok(stats.servers > 0, "серверы создаются миграциями");
    assert.equal(stats.listings, 2);
    assert.deepEqual(stats.sections, { items: 2, cars: 0, notary: 0 });
    assert.equal(stats.sellers, 1);
    assert.equal(stats.dealsMonth, 0);
    assert.equal(JSON.stringify(stats).includes("Site_Seller"), false, "без ников и логинов");
  });
});
