import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PushPollDto } from "@twm/shared";
import { notify } from "../../lib/notify.js";
import { setWebPushTransport } from "../../lib/web-push.js";
import { bearer, registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../../test-helpers.js";

describe("фоновые уведомления Android", { skip: skipWithoutDb }, () => {
  let env: TestEnv;

  before(async () => {
    env = await setupTestEnv();
  });
  after(async () => {
    await env.close();
  });

  const register = async (accessToken: string) => {
    const response = await env.app.inject({ method: "POST", url: "/v1/me/push-devices", headers: bearer(accessToken), payload: { platform: "android" } });
    assert.equal(response.statusCode, 201, response.body);
    return (response.json() as { token: string }).token;
  };
  const poll = (token: string, after?: number) =>
    env.app.inject({ method: "GET", url: `/v1/push/poll${after === undefined ? "" : `?after=${after}`}`, headers: { authorization: `Device ${token}` } });

  test("ключ устройства: только новые непрочитанные, без старых при первом опросе", async () => {
    const player = await registerUser(env);
    await notify(env.database.sql, player.user.id, "message", "Старое сообщение", "давно");
    const token = await register(player.accessToken);

    const first = (await poll(token)).json() as PushPollDto;
    assert.equal(first.items.length, 0, "при первом опросе старое не показываем");
    assert.ok(first.cursor > 0);

    await notify(env.database.sql, player.user.id, "message", "Новое сообщение: Кейс", "Привет!", "/chats/x");
    await notify(env.database.sql, player.user.id, "deal_proposed", "Подтвердите сделку");
    const second = (await poll(token, first.cursor)).json() as PushPollDto;
    assert.deepEqual(
      second.items.map((i) => i.title),
      ["Новое сообщение: Кейс", "Подтвердите сделку"],
      "по порядку",
    );
    assert.equal(second.items[0]?.link, "/chats/x");

    // Прочитанное в приложении — не показываем.
    await env.database.sql`UPDATE notifications SET read_at = now() WHERE user_id = ${player.user.id}`;
    assert.equal(((await poll(token, first.cursor)).json() as PushPollDto).items.length, 0);

    // Ключ устройства не годится для входа.
    assert.equal((await env.app.inject({ method: "GET", url: "/v1/me", headers: bearer(token) })).statusCode, 401);
  });

  test("неверный ключ, выход, блокировка и «выйти на всех устройствах» отключают устройство", async () => {
    const player = await registerUser(env);
    assert.equal((await poll("not-a-token")).statusCode, 401);

    const a = await register(player.accessToken);
    assert.equal((await poll(a)).statusCode, 200);
    assert.equal((await env.app.inject({ method: "DELETE", url: "/v1/push/device", headers: { authorization: `Device ${a}` } })).statusCode, 204);
    assert.equal((await poll(a)).statusCode, 401, "после выхода ключ не действует");

    const b = await register(player.accessToken);
    await env.database.sql`UPDATE users SET status = 'blocked' WHERE id = ${player.user.id}`;
    assert.equal((await poll(b)).statusCode, 401, "заблокированный аккаунт");
    await env.database.sql`UPDATE users SET status = 'active' WHERE id = ${player.user.id}`;
    assert.equal((await poll(b)).statusCode, 200);

    const revoke = await env.app.inject({ method: "POST", url: "/v1/me/sessions/revoke-others", headers: bearer(player.accessToken) });
    assert.equal(revoke.statusCode, 204, revoke.body);
    assert.equal((await poll(b)).statusCode, 401, "выход на других устройствах отзывает и ключи уведомлений");
  });

  test("не больше 8 устройств: старые вытесняются", async () => {
    const player = await registerUser(env);
    const tokens: string[] = [];
    for (let i = 0; i < 9; i += 1) tokens.push(await register(player.accessToken));
    assert.equal((await poll(tokens[0]!)).statusCode, 401);
    assert.equal((await poll(tokens[8]!)).statusCode, 200);
    const [count] = await env.database.sql<{ count: number }[]>`SELECT count(*)::int AS count FROM push_devices WHERE user_id = ${player.user.id}`;
    assert.equal(count?.count, 8);
  });

  test("веб-приложение: подписка Web Push, отправка, отписка по 410", async () => {
    const sent: Array<{ endpoint: string; body: string }> = [];
    let status = 201;
    setWebPushTransport(async (subscription, body) => {
      sent.push({ endpoint: subscription.endpoint, body });
      return status;
    });
    try {
      const key = (await env.app.inject({ method: "GET", url: "/v1/push/web-key" })).json() as { publicKey: string };
      assert.ok(key.publicKey.length > 40, "ключ VAPID создаётся сам");
      const again = (await env.app.inject({ method: "GET", url: "/v1/push/web-key" })).json() as { publicKey: string };
      assert.equal(again.publicKey, key.publicKey, "и не меняется");

      const player = await registerUser(env);
      const subscribe = (endpoint: string) =>
        env.app.inject({
          method: "POST",
          url: "/v1/me/push-devices",
          headers: bearer(player.accessToken),
          payload: { platform: "web", subscription: { endpoint, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } } },
        });
      assert.equal((await subscribe("http://127.0.0.1:3000/steal")).statusCode, 400, "только службы уведомлений браузеров");
      assert.equal((await subscribe("https://evil.example/push")).statusCode, 400);
      const endpoint = "https://web.push.apple.com/QGuQyavXutnMH8Ip2uWiAbbbbb";
      assert.equal((await subscribe(endpoint)).statusCode, 201);
      assert.equal((await subscribe(endpoint)).statusCode, 201, "повторная подписка того же браузера");
      const [devices] = await env.database.sql<{ count: number }[]>`SELECT count(*)::int AS count FROM push_devices WHERE endpoint = ${endpoint}`;
      assert.equal(devices?.count, 1, "без дублей");

      await notify(env.database.sql, player.user.id, "message", "Новое сообщение: Кейс", "Привет!", "/chats/abc");
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(sent.length, 1);
      const payload = JSON.parse(sent[0]!.body) as { id: number; title: string; link: string };
      assert.equal(payload.title, "Новое сообщение: Кейс");
      assert.equal(payload.link, "/chats/abc");
      assert.ok(payload.id > 0);

      // Браузер отписался — служба отвечает 410, подписка удаляется.
      status = 410;
      await notify(env.database.sql, player.user.id, "message", "Ещё сообщение");
      await new Promise((r) => setTimeout(r, 300));
      const [left] = await env.database.sql<{ count: number }[]>`SELECT count(*)::int AS count FROM push_devices WHERE endpoint = ${endpoint}`;
      assert.equal(left?.count, 0);
    } finally {
      setWebPushTransport(null);
    }
  });

  test("веб-приложение с адреса сайта: запросы к API разрешены (CORS)", async () => {
    const preflight = (origin: string) =>
      env.app.inject({
        method: "OPTIONS",
        url: "/v1/me",
        headers: { origin, "access-control-request-method": "GET", "access-control-request-headers": "authorization" },
      });
    for (const origin of ["https://twm-market.ru", "https://www.twm-market.ru"]) {
      const response = await preflight(origin);
      assert.equal(response.headers["access-control-allow-origin"], origin, origin);
    }
    const evil = await preflight("https://evil.example");
    assert.notEqual(evil.headers["access-control-allow-origin"], "https://evil.example");
  });
});
