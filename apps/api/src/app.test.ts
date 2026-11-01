import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig({ NODE_ENV: "test" });

test("GET /health отвечает ok", async () => {
  const app = await buildApp(config);
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "ok");
  await app.close();
});

test("GET /v1/servers возвращает 13 серверов", async () => {
  const app = await buildApp(config);
  const response = await app.inject({ method: "GET", url: "/v1/servers" });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { items: Array<{ name: string }> };
  assert.equal(body.items.length, 13);
  assert.equal(body.items[7]?.name, "SKY");
  await app.close();
});

test("CORS разрешает приложение и запрещает чужие сайты", async () => {
  const app = await buildApp(config);
  const allowed = await app.inject({
    method: "GET",
    url: "/health",
    headers: { origin: "http://tauri.localhost" },
  });
  assert.equal(allowed.headers["access-control-allow-origin"], "http://tauri.localhost");

  const foreign = await app.inject({
    method: "GET",
    url: "/health",
    headers: { origin: "https://evil.example" },
  });
  assert.equal(foreign.headers["access-control-allow-origin"], undefined);
  await app.close();
});

test("неизвестный маршрут — 404 с понятным сообщением", async () => {
  const app = await buildApp(config);
  const response = await app.inject({ method: "GET", url: "/nope" });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, "not_found");
  await app.close();
});

test("неверный порт в окружении останавливает запуск", () => {
  assert.throws(() => loadConfig({ PORT: "99999" }), /Неверные переменные окружения/);
});
