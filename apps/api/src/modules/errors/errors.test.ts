import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AppErrorGroupDto, AuthResponseDto } from "@twm/shared";
import { fingerprint, logError } from "../../lib/error-log.js";
import { bearer, createStaff, registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../../test-helpers.js";

test("отпечаток ошибки не зависит от чисел и идентификаторов", () => {
  const a = fingerprint({ source: "app", message: "Не найден элемент 15", stack: "Error\n    at render (main.js:10:5)" });
  const b = fingerprint({ source: "app", message: "Не найден элемент 27", stack: "Error\n    at render (main.js:11:7)" });
  const c = fingerprint({ source: "server", message: "Не найден элемент 15", stack: "" });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

describe("журнал ошибок", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  let admin: AuthResponseDto;

  before(async () => {
    env = await setupTestEnv();
    admin = await createStaff(env, "admin");
  });
  after(async () => {
    await env.close();
  });

  test("ошибки приложения и сервера группируются, видны только администратору", async () => {
    const player = await registerUser(env);
    for (const n of [1, 2]) {
      const sent = await env.app.inject({
        method: "POST",
        url: "/v1/client-errors",
        headers: n === 1 ? bearer(player.accessToken) : {},
        payload: { message: `Cannot read properties of undefined (reading 'x${n}')`.replace(/x\d/, "x"), stack: "TypeError\n    at Chat (app.js:1:2)", route: "/chats", version: "0.9.0" },
      });
      assert.equal(sent.statusCode, 204, sent.body);
    }
    await logError(env.database.sql, { source: "server", message: "connection terminated", stack: "Error\n    at query (db.js:5:1)", route: "GET /v1/listings" });

    const moderator = await createStaff(env, "moderator");
    assert.equal((await env.app.inject({ method: "GET", url: "/v1/admin/errors", headers: bearer(moderator.accessToken) })).statusCode, 403);
    assert.equal((await env.app.inject({ method: "GET", url: "/v1/admin/errors", headers: bearer(player.accessToken) })).statusCode, 403);

    const list = (await env.app.inject({ method: "GET", url: "/v1/admin/errors", headers: bearer(admin.accessToken) })).json() as { items: AppErrorGroupDto[] };
    const appGroup = list.items.find((i) => i.source === "app");
    assert.equal(appGroup?.count, 2);
    assert.equal(appGroup?.users, 1, "один вошедший игрок");
    assert.deepEqual(appGroup?.versions, ["0.9.0"]);
    assert.equal(list.items.find((i) => i.source === "server")?.route, "GET /v1/listings");

    const onlyServer = (await env.app.inject({ method: "GET", url: "/v1/admin/errors?source=server", headers: bearer(admin.accessToken) })).json() as { items: AppErrorGroupDto[] };
    assert.deepEqual(onlyServer.items.map((i) => i.source), ["server"]);

    const bad = await env.app.inject({ method: "POST", url: "/v1/client-errors", payload: { message: "" } });
    assert.equal(bad.statusCode, 400);
  });

  test("/health проверяет базу", async () => {
    const health = await env.app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().status, "ok");
  });
});
