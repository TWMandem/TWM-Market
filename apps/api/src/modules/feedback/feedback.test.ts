import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { FeedbackDto } from "@twm/shared";
import { bearer, createStaff, registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../../test-helpers.js";

describe("предложения по улучшению", { skip: skipWithoutDb }, () => {
  let env: TestEnv;

  before(async () => {
    env = await setupTestEnv();
  });
  after(async () => {
    await env.close();
  });

  test("игрок отправляет предложение, администратор отвечает", async () => {
    const player = await registerUser(env);
    const unauthorized = await env.app.inject({ method: "POST", url: "/v1/feedback", payload: {} });
    assert.equal(unauthorized.statusCode, 401);

    const created = await env.app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: bearer(player.accessToken),
      payload: {
        category: "improvement",
        title: "Сохранять фильтры каталога",
        description: "Хочу, чтобы выбранные фильтры сохранялись после перезапуска приложения.",
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const item = created.json() as FeedbackDto;
    assert.equal(item.status, "new");

    const mine = await env.app.inject({ method: "GET", url: "/v1/me/feedback", headers: bearer(player.accessToken) });
    assert.equal((mine.json() as { items: FeedbackDto[] }).items[0]?.title, item.title);

    const moderator = await createStaff(env, "moderator");
    assert.equal((await env.app.inject({ method: "GET", url: "/v1/admin/feedback", headers: bearer(moderator.accessToken) })).statusCode, 403);

    const admin = await createStaff(env, "admin");
    const updated = await env.app.inject({
      method: "PATCH",
      url: `/v1/admin/feedback/${item.id}`,
      headers: bearer(admin.accessToken),
      payload: { status: "planned", response: "Добавим в одну из следующих версий." },
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal((updated.json() as FeedbackDto).status, "planned");

    const mineAfter = await env.app.inject({ method: "GET", url: "/v1/me/feedback", headers: bearer(player.accessToken) });
    assert.equal((mineAfter.json() as { items: FeedbackDto[] }).items[0]?.response, "Добавим в одну из следующих версий.");
  });
});

