import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AuthResponseDto, GameProfileDto, SessionDto } from "@twm/shared";
import { bearer, registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../../test-helpers.js";

describe("личный кабинет и сессии", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  before(async () => {
    env = await setupTestEnv();
  });
  after(async () => {
    await env.close();
  });

  const login = async (identifier: string, password: string) =>
    (
      await env.app.inject({ method: "POST", url: "/v1/auth/login", payload: { identifier, password } })
    ).json() as AuthResponseDto;

  test("список сессий отмечает текущее устройство; чужую сессию закрыть нельзя", async () => {
    const user = await registerUser(env);
    const second = await login(user.user.login, user.password);

    const list = await env.app.inject({ method: "GET", url: "/v1/me/sessions", headers: bearer(second.accessToken) });
    const items = (list.json() as { items: SessionDto[] }).items;
    assert.equal(items.length, 2);
    assert.equal(items.filter((s) => s.current).length, 1);

    const other = await registerUser(env);
    const foreignId = items[0]!.id;
    const foreign = await env.app.inject({
      method: "DELETE",
      url: `/v1/me/sessions/${foreignId}`,
      headers: bearer(other.accessToken),
    });
    assert.equal(foreign.statusCode, 404);

    const firstSession = items.find((s) => !s.current)!;
    const revoke = await env.app.inject({
      method: "DELETE",
      url: `/v1/me/sessions/${firstSession.id}`,
      headers: bearer(second.accessToken),
    });
    assert.equal(revoke.statusCode, 204);
    const firstMe = await env.app.inject({ method: "GET", url: "/v1/me", headers: bearer(user.accessToken) });
    assert.equal(firstMe.statusCode, 401);
  });

  test("смена пароля требует текущий пароль и закрывает другие устройства", async () => {
    const user = await registerUser(env);
    const second = await login(user.user.login, user.password);

    const wrong = await env.app.inject({
      method: "POST",
      url: "/v1/me/password",
      headers: bearer(second.accessToken),
      payload: { currentPassword: "not-my-password", newPassword: "another-good-password" },
    });
    assert.equal(wrong.statusCode, 400);
    assert.ok(wrong.json().fields.currentPassword);

    const ok = await env.app.inject({
      method: "POST",
      url: "/v1/me/password",
      headers: bearer(second.accessToken),
      payload: { currentPassword: user.password, newPassword: "another-good-password" },
    });
    assert.equal(ok.statusCode, 204);

    const firstMe = await env.app.inject({ method: "GET", url: "/v1/me", headers: bearer(user.accessToken) });
    assert.equal(firstMe.statusCode, 401, "другое устройство вышло");
    const secondMe = await env.app.inject({ method: "GET", url: "/v1/me", headers: bearer(second.accessToken) });
    assert.equal(secondMe.statusCode, 200, "текущее устройство осталось");
  });
});

describe("игровые профили", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  before(async () => {
    env = await setupTestEnv();
  });
  after(async () => {
    await env.close();
  });

  const create = (token: string, nickname: string, serverNumber = 8) =>
    env.app.inject({
      method: "POST",
      url: "/v1/me/game-profiles",
      headers: bearer(token),
      payload: { nickname, serverNumber },
    });

  test("добавление, список, дубликаты, несуществующий сервер", async () => {
    const user = await registerUser(env);
    const created = await create(user.accessToken, "Max_Volkov");
    assert.equal(created.statusCode, 201);
    const profile = created.json() as GameProfileDto;
    assert.equal(profile.server.name, "SKY");
    assert.equal(profile.verified, false);
    assert.equal(profile.sameNicknameCount, 0);

    assert.equal((await create(user.accessToken, "max_volkov")).statusCode, 409, "тот же ник без учёта регистра");
    assert.equal((await create(user.accessToken, "Max_Volkov", 1)).statusCode, 201, "тот же ник на другом сервере");

    const badServer = await create(user.accessToken, "Someone", 99);
    assert.equal(badServer.statusCode, 400);
    assert.ok(badServer.json().fields.serverNumber);

    const list = await env.app.inject({ method: "GET", url: "/v1/me/game-profiles", headers: bearer(user.accessToken) });
    assert.equal((list.json() as { items: GameProfileDto[] }).items.length, 2);
  });

  test("одинаковый ник у разных аккаунтов разрешён, но виден счётчик", async () => {
    const first = await registerUser(env);
    const second = await registerUser(env);
    await create(first.accessToken, "Shared_Nick");
    const response = await create(second.accessToken, "shared_nick");
    assert.equal(response.statusCode, 201);
    assert.equal((response.json() as GameProfileDto).sameNicknameCount, 1);
  });

  test("смена ника: история и ограничение по времени", async () => {
    const user = await registerUser(env);
    const profile = (await create(user.accessToken, "Old_Nick")).json() as GameProfileDto;

    const rename = await env.app.inject({
      method: "PATCH",
      url: `/v1/me/game-profiles/${profile.id}`,
      headers: bearer(user.accessToken),
      payload: { nickname: "New_Nick" },
    });
    assert.equal(rename.statusCode, 200);
    const renamed = rename.json() as GameProfileDto;
    assert.equal(renamed.nickname, "New_Nick");
    assert.ok(renamed.nicknameChangeAvailableAt, "следующая смена не сразу");

    const history = await env.database.sql<{ oldNickname: string; newNickname: string }[]>`
      SELECT old_nickname, new_nickname FROM game_profile_history WHERE profile_id = ${profile.id}`;
    assert.deepEqual(
      history.map((h) => [h.oldNickname, h.newNickname]),
      [["Old_Nick", "New_Nick"]],
    );

    const again = await env.app.inject({
      method: "PATCH",
      url: `/v1/me/game-profiles/${profile.id}`,
      headers: bearer(user.accessToken),
      payload: { nickname: "Third_Nick" },
    });
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().error, "nickname_cooldown");
  });

  test("чужой профиль нельзя изменить или удалить", async () => {
    const owner = await registerUser(env);
    const stranger = await registerUser(env);
    const profile = (await create(owner.accessToken, "Owner_Nick")).json() as GameProfileDto;

    const patch = await env.app.inject({
      method: "PATCH",
      url: `/v1/me/game-profiles/${profile.id}`,
      headers: bearer(stranger.accessToken),
      payload: { nickname: "Stolen" },
    });
    assert.equal(patch.statusCode, 404);

    const del = await env.app.inject({
      method: "DELETE",
      url: `/v1/me/game-profiles/${profile.id}`,
      headers: bearer(stranger.accessToken),
    });
    assert.equal(del.statusCode, 404);

    const ownDelete = await env.app.inject({
      method: "DELETE",
      url: `/v1/me/game-profiles/${profile.id}`,
      headers: bearer(owner.accessToken),
    });
    assert.equal(ownDelete.statusCode, 204);
  });

  test("не больше 10 профилей на аккаунт", async () => {
    const user = await registerUser(env);
    for (let i = 0; i < 10; i++) {
      assert.equal((await create(user.accessToken, `Nick_${i}`)).statusCode, 201);
    }
    const extra = await create(user.accessToken, "Nick_extra");
    assert.equal(extra.statusCode, 409);
    assert.equal(extra.json().error, "profile_limit");
  });
});
