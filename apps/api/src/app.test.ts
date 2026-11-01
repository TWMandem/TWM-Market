import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.js";
import { setupTestEnv, skipWithoutDb, type TestEnv } from "./test-helpers.js";

test("неверный порт в окружении останавливает запуск", () => {
  assert.throws(() => loadConfig({ PORT: "99999" }), /Неверные переменные окружения/);
});

test("без секретов сервер не стартует вне тестов", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production" }), /JWT_SECRET/);
});

test("секреты из примера .env отклоняются в production", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        JWT_SECRET: "замените-на-случайную-строку-не-короче-32-символов",
        CODE_SECRET: "x".repeat(40),
      }),
    /оставлено значение из примера/,
  );
});

describe("общие маршруты", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  before(async () => {
    env = await setupTestEnv();
  });
  after(async () => {
    await env.close();
  });

  test("GET /health отвечает ok", async () => {
    const response = await env.app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "ok");
  });

  test("GET /v1/servers возвращает 13 серверов из базы", async () => {
    const response = await env.app.inject({ method: "GET", url: "/v1/servers" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { items: Array<{ name: string; number: number }> };
    assert.equal(body.items.length, 13);
    assert.equal(body.items.find((s) => s.number === 8)?.name, "SKY");
  });

  test("CORS разрешает приложение и запрещает чужие сайты", async () => {
    const allowed = await env.app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://tauri.localhost" },
    });
    assert.equal(allowed.headers["access-control-allow-origin"], "http://tauri.localhost");

    const foreign = await env.app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://evil.example" },
    });
    assert.equal(foreign.headers["access-control-allow-origin"], undefined);
  });

  test("неизвестный маршрут — 404 с понятным сообщением", async () => {
    const response = await env.app.inject({ method: "GET", url: "/nope" });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "not_found");
  });

  test("повторный запуск миграций ничего не ломает", async () => {
    const { migrate } = await import("./db/migrate.js");
    const applied = await migrate(env.database.sql);
    assert.deepEqual(applied, []);
  });
});
