import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AuthResponseDto } from "@twm/shared";
import { bearer, registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../../test-helpers.js";

describe("регистрация и вход", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  before(async () => {
    env = await setupTestEnv();
  });
  after(async () => {
    await env.close();
  });

  test("регистрация выдаёт токены и отправляет код", async () => {
    const result = await registerUser(env, { login: "Max_Volk", email: "Max@Example.com" });
    assert.ok(result.accessToken);
    assert.ok(result.refreshToken);
    assert.equal(result.user.login, "Max_Volk");
    assert.equal(result.user.email, "max@example.com");
    assert.equal(result.user.emailVerified, false);
    assert.equal(result.user.role, "user");
    assert.match(env.mailer.lastCode("max@example.com") ?? "", /^\d{6}$/);
  });

  test("логин и email заняты без учёта регистра", async () => {
    await registerUser(env, { login: "taken_login", email: "taken@example.com" });
    const byLogin = await env.app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { login: "TAKEN_LOGIN", email: "other@example.com", password: "correct-horse-battery", rulesAccepted: true },
    });
    assert.equal(byLogin.statusCode, 409);
    assert.equal(byLogin.json().error, "login_taken");
    assert.ok(byLogin.json().fields.login);

    const byEmail = await env.app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { login: "fresh_login", email: "TAKEN@example.com", password: "correct-horse-battery", rulesAccepted: true },
    });
    assert.equal(byEmail.statusCode, 409);
    assert.equal(byEmail.json().error, "email_taken");
  });

  test("неверные данные — 400 с ошибками по полям", async () => {
    const response = await env.app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { login: "a", email: "nope", password: "short", rulesAccepted: false },
    });
    assert.equal(response.statusCode, 400);
    const body = response.json();
    assert.equal(body.error, "validation_error");
    for (const field of ["login", "email", "password", "rulesAccepted"]) assert.ok(body.fields[field], field);
  });

  test("зарезервированный логин нельзя занять", async () => {
    const response = await env.app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { login: "Admin", email: "admin@example.com", password: "correct-horse-battery", rulesAccepted: true },
    });
    assert.equal(response.statusCode, 400);
    assert.ok(response.json().fields.login);
  });

  test("вход по логину и по email; пароль не хранится в открытом виде", async () => {
    const user = await registerUser(env, { login: "login_user", email: "login_user@example.com" });

    const byLogin = await env.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { identifier: "LOGIN_USER", password: user.password },
    });
    assert.equal(byLogin.statusCode, 200);

    const byEmail = await env.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { identifier: "login_user@example.com", password: user.password },
    });
    assert.equal(byEmail.statusCode, 200);

    const [row] = await env.database.sql<{ passwordHash: string }[]>`
      SELECT password_hash FROM users WHERE login = 'login_user'`;
    assert.ok(row?.passwordHash.startsWith("$argon2id$"));
    assert.ok(!row?.passwordHash.includes(user.password));
  });

  test("неверный пароль и несуществующий логин дают одинаковую ошибку", async () => {
    const user = await registerUser(env);
    const wrong = await env.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { identifier: user.user.login, password: "wrong-password-123" },
    });
    const unknown = await env.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { identifier: "nobody_here", password: "wrong-password-123" },
    });
    assert.equal(wrong.statusCode, 401);
    assert.equal(unknown.statusCode, 401);
    assert.deepEqual(wrong.json(), unknown.json());
  });

  test("после 5 неверных паролей вход блокируется на время", async () => {
    const user = await registerUser(env);
    for (let i = 0; i < 5; i++) {
      await env.app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { identifier: user.user.login, password: `wrong-password-${i}` },
      });
    }
    const locked = await env.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { identifier: user.user.login, password: user.password },
    });
    assert.equal(locked.statusCode, 423);
    assert.equal(locked.json().error, "account_locked");
  });

  test("заблокированный пользователь не может войти и теряет доступ сразу", async () => {
    const user = await registerUser(env);
    await env.database.sql`UPDATE users SET status = 'blocked' WHERE id = ${user.user.id}`;

    const me = await env.app.inject({ method: "GET", url: "/v1/me", headers: bearer(user.accessToken) });
    assert.equal(me.statusCode, 403);
    assert.equal(me.json().error, "account_blocked");

    const login = await env.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { identifier: user.user.login, password: user.password },
    });
    assert.equal(login.statusCode, 403);
  });
});

describe("токены и сессии", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  before(async () => {
    env = await setupTestEnv();
  });
  after(async () => {
    await env.close();
  });

  const refresh = (token: string) =>
    env.app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: token } });

  test("без токена и с поддельным токеном — 401", async () => {
    const none = await env.app.inject({ method: "GET", url: "/v1/me" });
    assert.equal(none.statusCode, 401);
    const fake = await env.app.inject({ method: "GET", url: "/v1/me", headers: bearer("abc.def.ghi") });
    assert.equal(fake.statusCode, 401);
  });

  test("refresh выдаёт новую пару, старый токен перестаёт действовать", async () => {
    const user = await registerUser(env);
    const first = await refresh(user.refreshToken);
    assert.equal(first.statusCode, 200);
    const next = first.json() as AuthResponseDto;
    assert.notEqual(next.refreshToken, user.refreshToken);

    const me = await env.app.inject({ method: "GET", url: "/v1/me", headers: bearer(next.accessToken) });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().login, user.user.login);
  });

  test("повторное использование старого refresh-токена закрывает сессию", async () => {
    const user = await registerUser(env);
    const rotated = (await refresh(user.refreshToken)).json() as AuthResponseDto;

    const reuse = await refresh(user.refreshToken);
    assert.equal(reuse.statusCode, 401);

    // Сессия закрыта целиком: новый токен тоже больше не работает.
    const afterReuse = await refresh(rotated.refreshToken);
    assert.equal(afterReuse.statusCode, 401);
  });

  test("выход закрывает сессию и токен доступа сразу перестаёт работать", async () => {
    const user = await registerUser(env);
    const logout = await env.app.inject({ method: "POST", url: "/v1/auth/logout", headers: bearer(user.accessToken) });
    assert.equal(logout.statusCode, 204);
    const me = await env.app.inject({ method: "GET", url: "/v1/me", headers: bearer(user.accessToken) });
    assert.equal(me.statusCode, 401);
    assert.equal((await refresh(user.refreshToken)).statusCode, 401);
  });

  test("в базе хранится только хеш refresh-токена", async () => {
    const user = await registerUser(env);
    const rows = await env.database.sql<{ tokenHash: string }[]>`
      SELECT token_hash FROM sessions WHERE user_id = ${user.user.id}`;
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0]?.tokenHash, user.refreshToken);
    assert.match(rows[0]?.tokenHash ?? "", /^[0-9a-f]{64}$/);
  });
});

describe("коды из писем", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  before(async () => {
    env = await setupTestEnv();
  });
  after(async () => {
    await env.close();
  });

  test("подтверждение email верным кодом", async () => {
    const user = await registerUser(env);
    const wrong = await env.app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      headers: bearer(user.accessToken),
      payload: { code: "000000" === env.mailer.lastCode(user.user.email) ? "111111" : "000000" },
    });
    assert.equal(wrong.statusCode, 400);
    assert.equal(wrong.json().error, "invalid_code");

    const ok = await env.app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      headers: bearer(user.accessToken),
      payload: { code: env.mailer.lastCode(user.user.email) },
    });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().emailVerified, true);
  });

  test("после 5 ошибок код сгорает даже для верного значения", async () => {
    const user = await registerUser(env);
    const code = env.mailer.lastCode(user.user.email) ?? "";
    const wrongCode = code === "123456" ? "654321" : "123456";
    for (let i = 0; i < 5; i++) {
      await env.app.inject({
        method: "POST",
        url: "/v1/auth/verify-email",
        headers: bearer(user.accessToken),
        payload: { code: wrongCode },
      });
    }
    const late = await env.app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      headers: bearer(user.accessToken),
      payload: { code },
    });
    assert.equal(late.statusCode, 400);
    assert.equal(late.json().error, "too_many_attempts");
  });

  test("новый код можно запросить не чаще раза в минуту", async () => {
    const user = await registerUser(env);
    const resend = await env.app.inject({
      method: "POST",
      url: "/v1/auth/verify-email/resend",
      headers: bearer(user.accessToken),
    });
    assert.equal(resend.statusCode, 429);
    assert.equal(resend.json().error, "resend_too_soon");
  });

  test("сброс пароля: одинаковый ответ, код, новый пароль, выход со всех устройств", async () => {
    const user = await registerUser(env);

    const unknown = await env.app.inject({
      method: "POST",
      url: "/v1/auth/password/forgot",
      payload: { email: "nobody@example.com" },
    });
    const known = await env.app.inject({
      method: "POST",
      url: "/v1/auth/password/forgot",
      payload: { email: user.user.email },
    });
    assert.equal(unknown.statusCode, 202);
    assert.equal(known.statusCode, 202);
    assert.deepEqual(unknown.json(), known.json());

    const resetMail = env.mailer.sent.at(-1);
    assert.match(resetMail?.subject ?? "", /Сброс пароля/);
    const code = env.mailer.lastCode(user.user.email);

    const reset = await env.app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      payload: { email: user.user.email, code, password: "brand-new-password-42" },
    });
    assert.equal(reset.statusCode, 200);

    // Старая сессия закрыта.
    const oldMe = await env.app.inject({ method: "GET", url: "/v1/me", headers: bearer(user.accessToken) });
    assert.equal(oldMe.statusCode, 401);

    const oldPassword = await env.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { identifier: user.user.login, password: user.password },
    });
    assert.equal(oldPassword.statusCode, 401);

    const newPassword = await env.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { identifier: user.user.login, password: "brand-new-password-42" },
    });
    assert.equal(newPassword.statusCode, 200);
    assert.equal((newPassword.json() as AuthResponseDto).user.emailVerified, true);
  });
});

describe("ограничение частоты запросов", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  before(async () => {
    env = await setupTestEnv({ RATE_LIMIT: "true" });
  });
  after(async () => {
    await env.close();
  });

  test("в списке входов видно, какая версия вошла: приложение или веб-версия", async () => {
    const user = await registerUser(env, { login: "client_kind", email: "client_kind@example.com" });
    const login = (client?: string) =>
      env.app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36", ...(client ? { "x-twm-client": client } : {}) },
        payload: { identifier: "client_kind", password: user.password },
      });
    assert.equal((await login("web")).statusCode, 200);
    assert.equal((await login("hacker <b>")).statusCode, 200);
    const rows = await env.database.sql<{ userAgent: string }[]>`
      SELECT s.user_agent FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.login = 'client_kind' ORDER BY s.created_at`;
    assert.ok(rows.some((r) => r.userAgent.endsWith(" TWMClient/web")), "веб-версия помечена");
    assert.ok(rows.every((r) => !r.userAgent.includes("hacker")), "чужие значения не записываются");
  });

  test("после 10 попыток входа в минуту — 429", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const response = await env.app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { identifier: "someone", password: "whatever-123" },
      });
      last = response.statusCode;
    }
    assert.equal(last, 429);
  });
});
