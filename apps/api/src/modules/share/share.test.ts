import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AuthResponseDto, GameProfileDto, ListingTypeDto, MyListingDto } from "@twm/shared";
import { bearer, createStaff, registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../../test-helpers.js";

describe("страница-ссылка на объявление для мессенджеров", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  let admin: AuthResponseDto;

  const call = (method: "GET" | "POST", url: string, token?: string, payload?: unknown) =>
    env.app.inject({ method, url, headers: token ? bearer(token) : {}, ...(payload === undefined ? {} : { payload: payload as object }) });

  before(async () => {
    env = await setupTestEnv({ SITE_URL: "https://twm-market.example" });
    admin = await createStaff(env, "admin");
  });
  after(async () => {
    await env.close();
  });

  test("карточка с ценой и картинкой, текст экранирован, снятое — 404", async () => {
    const types = ((await call("GET", "/v1/admin/listing-types", admin.accessToken)).json() as { items: ListingTypeDto[] }).items;
    const category = (await call("POST", "/v1/admin/categories", admin.accessToken, { sectionCode: "items", name: "Ссылки" })).json() as { id: number };
    const item = (await call("POST", "/v1/admin/catalog-items", admin.accessToken, { categoryId: category.id, name: "Шляпа <b>" })).json() as { id: number };
    const seller = await registerUser(env);
    await env.database.sql`UPDATE users SET email_verified_at = now() WHERE id = ${seller.user.id}`;
    const profile = (await call("POST", "/v1/me/game-profiles", seller.accessToken, { nickname: "Share_Seller", serverNumber: 1 })).json() as GameProfileDto;
    const created = await call("POST", "/v1/listings", seller.accessToken, {
      gameProfileId: profile.id,
      listingTypeId: types.find((t) => t.code === "item")!.id,
      operation: "sell",
      catalogItemId: item.id,
      price: 2_500_000,
      description: 'Отличная шляпа <script>alert("x")</script>',
    });
    assert.equal(created.statusCode, 201, created.body);
    const id = (created.json() as MyListingDto).id;
    assert.equal((await call("POST", `/v1/listings/${id}/publish`, seller.accessToken)).statusCode, 200);

    const response = await call("GET", `/share/l/${id}`);
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers["content-type"]), /text\/html/);
    const html = response.body;
    assert.match(html, /<meta property="og:title" content="Шляпа &lt;b&gt; — 2.500.000.₽">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/twm-market\.example\/img\/og\.jpg">/, "без фото — картинка сайта");
    assert.match(html, /og:url" content="https:\/\/twm-market\.example\/l\//);
    assert.match(html, new RegExp(`twm-market://listing/${id}`));
    assert.match(html, new RegExp(`https://twm-market\\.example/app/#/listing/${id}`), "ссылка на веб-приложение (iPhone)");
    assert.match(html, /Share_Seller/);
    assert.ok(!html.includes("<script>"), "описание экранировано");
    assert.ok(!html.includes(seller.user.login), "логин продавца не раскрывается");
    assert.ok(!html.includes(seller.user.email));

    await call("POST", `/v1/listings/${id}/withdraw`, seller.accessToken);
    assert.equal((await call("GET", `/share/l/${id}`)).statusCode, 404, "снятое объявление не показывается");
    assert.equal((await call("GET", "/share/l/not-a-uuid")).statusCode, 404);
  });
});
