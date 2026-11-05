import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AdminAppearanceDto, AppearanceDto, PublicStatsDto } from "@twm/shared";
import { bearer, createStaff, setupTestEnv, skipWithoutDb, type TestEnv } from "../../test-helpers.js";

describe("праздничное оформление", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let moderator: Awaited<ReturnType<typeof createStaff>>;

  const put = (token: string, payload: unknown) =>
    env.app.inject({ method: "PUT", url: "/v1/admin/appearance", headers: bearer(token), payload: payload as object });
  const current = async () => ((await env.app.inject({ method: "GET", url: "/v1/appearance" })).json() as AppearanceDto).season;

  before(async () => {
    env = await setupTestEnv();
    admin = await createStaff(env, "admin");
    moderator = await createStaff(env, "moderator");
  });
  after(async () => {
    await env?.close();
  });

  test("включает и выключает только администратор; видно всем без входа", async () => {
    assert.equal(await current(), null);

    assert.equal((await put(moderator.accessToken, { season: "halloween", until: null })).statusCode, 403);
    assert.equal((await env.app.inject({ method: "PUT", url: "/v1/admin/appearance", payload: { season: "halloween", until: null } })).statusCode, 401);

    const on = await put(admin.accessToken, { season: "halloween", until: null });
    assert.equal(on.statusCode, 200, on.body);
    const dto = on.json() as AdminAppearanceDto;
    assert.equal(dto.season, "halloween");
    assert.equal(dto.updatedBy, admin.user.login);
    assert.equal(await current(), "halloween");

    const audit = await env.database.sql`SELECT 1 FROM audit_log WHERE action = 'appearance.updated'`;
    assert.ok(audit.length >= 1, "действие записано в журнал");

    const off = await put(admin.accessToken, { season: null, until: null });
    assert.equal(off.statusCode, 200);
    assert.equal(await current(), null);
  });

  test("выключается само в указанную дату; прошедшая дата и чужое оформление не принимаются", async () => {
    assert.equal((await put(admin.accessToken, { season: "halloween", until: "2020-01-01T00:00:00Z" })).statusCode, 400);
    assert.equal((await put(admin.accessToken, { season: "christmas-hack", until: null })).statusCode, 400);

    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    assert.equal((await put(admin.accessToken, { season: "halloween", until: soon })).statusCode, 200);
    assert.equal(await current(), "halloween");

    // Время вышло — оформления больше нет, хотя настройку никто не трогал.
    await env.database.sql`UPDATE app_appearance SET until = now() - interval '1 minute' WHERE id = 1`;
    assert.equal(await current(), null);
  });

  test("сайт узнаёт об оформлении из общих цифр (stats.json)", async () => {
    await put(admin.accessToken, { season: "halloween", until: null });
    const stats = (await env.app.inject({ method: "GET", url: "/v1/public/stats" })).json() as PublicStatsDto;
    assert.equal(stats.season, "halloween");
  });
});
