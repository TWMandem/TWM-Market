import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type {
  AdminStatsDto,
  AdminUserDetailDto,
  AttributeDefinitionDto,
  AuditEntryDto,
  CategoryDto,
  ListingTypeDto,
  Paged,
} from "@twm/shared";
import { currentStep, totpAt } from "../../lib/totp.js";
import { bearer, createStaff, registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../../test-helpers.js";

describe("доступ к админ-панели и двухфакторный вход", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  before(async () => {
    env = await setupTestEnv();
  });
  after(async () => {
    await env.close();
  });

  const stats = (token: string) => env.app.inject({ method: "GET", url: "/v1/admin/stats", headers: bearer(token) });

  test("обычный игрок не попадает в админку", async () => {
    const user = await registerUser(env);
    const response = await stats(user.accessToken);
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, "forbidden");
  });

  test("модератору без 2FA нужно её включить", async () => {
    const moderator = await createStaff(env, "moderator", { enable2fa: false });
    const response = await stats(moderator.accessToken);
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, "mfa_setup_required");
  });

  test("включение 2FA: неверный код не принимается, верный открывает доступ", async () => {
    const admin = await createStaff(env, "admin", { enable2fa: false });
    const setup = await env.app.inject({ method: "POST", url: "/v1/me/2fa/setup", headers: bearer(admin.accessToken) });
    assert.equal(setup.statusCode, 200);
    const { secret, otpauthUrl } = setup.json() as { secret: string; otpauthUrl: string };
    assert.match(otpauthUrl, /^otpauth:\/\/totp\/TWM%20Market/);

    const [row] = await env.database.sql<{ totpSecretEnc: string }[]>`
      SELECT totp_secret_enc FROM users WHERE id = ${admin.user.id}`;
    assert.ok(row && !row.totpSecretEnc.includes(secret), "секрет в базе зашифрован");

    const wrongCode = totpAt(secret, currentStep() + 10);
    const wrong = await env.app.inject({
      method: "POST",
      url: "/v1/me/2fa/enable",
      headers: bearer(admin.accessToken),
      payload: { code: wrongCode },
    });
    assert.equal(wrong.statusCode, 400);

    const ok = await env.app.inject({
      method: "POST",
      url: "/v1/me/2fa/enable",
      headers: bearer(admin.accessToken),
      payload: { code: totpAt(secret, currentStep()) },
    });
    assert.equal(ok.statusCode, 200);
    assert.equal((await stats(admin.accessToken)).statusCode, 200);
  });

  test("после нового входа нужен код; один код нельзя использовать дважды", async () => {
    const admin = await createStaff(env, "admin");
    const login = await env.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { identifier: admin.user.login, password: admin.password },
    });
    const token = login.json().accessToken as string;
    const blocked = await stats(token);
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json().error, "mfa_required");

    // Код текущего шага уже потрачен при включении — берём следующий.
    const code = totpAt(admin.totpSecret!, currentStep() + 1);
    const verify = await env.app.inject({ method: "POST", url: "/v1/me/2fa/verify", headers: bearer(token), payload: { code } });
    assert.equal(verify.statusCode, 200);
    assert.equal((await stats(token)).statusCode, 200);

    const again = await env.app.inject({ method: "POST", url: "/v1/me/2fa/verify", headers: bearer(token), payload: { code } });
    assert.equal(again.statusCode, 400, "повторное использование кода");
  });

  test("статистика считает пользователей и регистрации по дням", async () => {
    const admin = await createStaff(env, "admin");
    const response = await stats(admin.accessToken);
    const body = response.json() as AdminStatsDto;
    assert.ok(body.users.total >= 1);
    assert.equal(body.registrationsByDay.length, 30);
    assert.ok((body.registrationsByDay.at(-1)?.count ?? 0) >= 1);
  });
});

describe("управление пользователями", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  before(async () => {
    env = await setupTestEnv();
    admin = await createStaff(env, "admin");
  });
  after(async () => {
    await env.close();
  });

  test("поиск по логину и фильтр по роли", async () => {
    await registerUser(env, { login: "findme_please" });
    const found = await env.app.inject({
      method: "GET",
      url: "/v1/admin/users?query=findme",
      headers: bearer(admin.accessToken),
    });
    const body = found.json() as Paged<{ login: string }>;
    assert.equal(body.total, 1);
    assert.equal(body.items[0]?.login, "findme_please");

    const staff = await env.app.inject({ method: "GET", url: "/v1/admin/users?role=staff", headers: bearer(admin.accessToken) });
    assert.ok((staff.json() as Paged<{ role: string }>).items.every((u) => u.role !== "user"));
  });

  test("блокировка закрывает сессии, разблокировка возвращает доступ; всё в журнале", async () => {
    const player = await registerUser(env);
    const block = await env.app.inject({
      method: "POST",
      url: `/v1/admin/users/${player.user.id}/block`,
      headers: bearer(admin.accessToken),
      payload: { reason: "Мошенничество с обменом" },
    });
    assert.equal(block.statusCode, 200);
    const detail = block.json() as AdminUserDetailDto;
    assert.equal(detail.status, "blocked");
    assert.equal(detail.blockedReason, "Мошенничество с обменом");
    assert.equal(detail.activeSessions, 0);

    const me = await env.app.inject({ method: "GET", url: "/v1/me", headers: bearer(player.accessToken) });
    assert.equal(me.statusCode, 401);

    const unblock = await env.app.inject({
      method: "POST",
      url: `/v1/admin/users/${player.user.id}/unblock`,
      headers: bearer(admin.accessToken),
    });
    assert.equal(unblock.statusCode, 200);
    const login = await env.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { identifier: player.user.login, password: player.password },
    });
    assert.equal(login.statusCode, 200);

    const audit = await env.app.inject({ method: "GET", url: "/v1/admin/audit", headers: bearer(admin.accessToken) });
    const actions = (audit.json() as Paged<AuditEntryDto>).items.map((e) => e.action);
    assert.ok(actions.includes("user.blocked"));
    assert.ok(actions.includes("user.unblocked"));
  });

  test("нельзя блокировать себя и равных по роли; модератор не блокирует", async () => {
    const self = await env.app.inject({
      method: "POST",
      url: `/v1/admin/users/${admin.user.id}/block`,
      headers: bearer(admin.accessToken),
      payload: { reason: "проверка" },
    });
    assert.equal(self.statusCode, 403);

    const otherAdmin = await createStaff(env, "admin");
    const peer = await env.app.inject({
      method: "POST",
      url: `/v1/admin/users/${otherAdmin.user.id}/block`,
      headers: bearer(admin.accessToken),
      payload: { reason: "проверка" },
    });
    assert.equal(peer.statusCode, 403);

    const moderator = await createStaff(env, "moderator");
    const player = await registerUser(env);
    const byModerator = await env.app.inject({
      method: "POST",
      url: `/v1/admin/users/${player.user.id}/block`,
      headers: bearer(moderator.accessToken),
      payload: { reason: "проверка" },
    });
    assert.equal(byModerator.statusCode, 403);
  });

  test("роли меняет только суперадминистратор, и не выше admin", async () => {
    const player = await registerUser(env);
    const byAdmin = await env.app.inject({
      method: "POST",
      url: `/v1/admin/users/${player.user.id}/role`,
      headers: bearer(admin.accessToken),
      payload: { role: "moderator" },
    });
    assert.equal(byAdmin.statusCode, 403);

    const superadmin = await createStaff(env, "superadmin");
    const promote = await env.app.inject({
      method: "POST",
      url: `/v1/admin/users/${player.user.id}/role`,
      headers: bearer(superadmin.accessToken),
      payload: { role: "moderator" },
    });
    assert.equal(promote.statusCode, 200);
    assert.equal((promote.json() as AdminUserDetailDto).role, "moderator");

    const toSuper = await env.app.inject({
      method: "POST",
      url: `/v1/admin/users/${player.user.id}/role`,
      headers: bearer(superadmin.accessToken),
      payload: { role: "superadmin" },
    });
    assert.equal(toSuper.statusCode, 400);
  });

  test("журнал нельзя изменить даже напрямую в базе", async () => {
    await assert.rejects(env.database.sql`UPDATE audit_log SET action = 'hacked'`, /Журнал действий нельзя изменять/);
    await assert.rejects(env.database.sql`DELETE FROM audit_log`, /Журнал действий нельзя изменять/);
  });
});

describe("справочники", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let moderator: Awaited<ReturnType<typeof createStaff>>;
  before(async () => {
    env = await setupTestEnv();
    admin = await createStaff(env, "admin");
    moderator = await createStaff(env, "moderator");
  });
  after(async () => {
    await env.close();
  });

  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown, token = admin.accessToken) =>
    env.app.inject({ method, url, headers: bearer(token), ...(payload === undefined ? {} : { payload: payload as object }) });

  test("типы имущества из ТЗ уже есть, модератор видит, но не меняет", async () => {
    const list = await call("GET", "/v1/admin/listing-types", undefined, moderator.accessToken);
    assert.equal(list.statusCode, 200);
    const types = (list.json() as { items: ListingTypeDto[] }).items;
    assert.equal(types.filter((t) => t.sectionCode === "notary").length, 9);
    assert.deepEqual(types.find((t) => t.code === "apartment")?.operations, ["sell"]);

    const create = await call(
      "POST",
      "/v1/admin/listing-types",
      { sectionCode: "items", code: "rare_item", name: "Редкий предмет", operations: ["sell"] },
      moderator.accessToken,
    );
    assert.equal(create.statusCode, 403);
  });

  test("серверы: добавить 14-й, изменить, дубликат номера", async () => {
    const created = await call("POST", "/v1/admin/servers", { number: 14, name: "OCEAN", color: "#1E90FF" });
    assert.equal(created.statusCode, 201);
    const duplicate = await call("POST", "/v1/admin/servers", { number: 14, name: "OTHER", color: "#1E90FF" });
    assert.equal(duplicate.statusCode, 409);
    const patch = await call("PATCH", "/v1/admin/servers/14", { isActive: false, transferOpen: false });
    assert.equal(patch.statusCode, 200);
    assert.equal(patch.json().isActive, false);

    const publicList = await env.app.inject({ method: "GET", url: "/v1/servers" });
    assert.ok(!(publicList.json() as { items: Array<{ number: number }> }).items.some((s) => s.number === 14));
  });

  test("категории: два уровня, уникальные имена, удаление только пустых", async () => {
    const root = await call("POST", "/v1/admin/categories", { sectionCode: "items", name: "Аксессуары" });
    assert.equal(root.statusCode, 201);
    const rootId = (root.json() as CategoryDto).id;

    const child = await call("POST", "/v1/admin/categories", { sectionCode: "items", parentId: rootId, name: "Очки" });
    assert.equal(child.statusCode, 201);
    const childId = (child.json() as CategoryDto).id;

    const third = await call("POST", "/v1/admin/categories", { sectionCode: "items", parentId: childId, name: "Глубже" });
    assert.equal(third.statusCode, 400, "третий уровень не нужен");

    const wrongSection = await call("POST", "/v1/admin/categories", { sectionCode: "cars", parentId: rootId, name: "Седаны" });
    assert.equal(wrongSection.statusCode, 400);

    const dup = await call("POST", "/v1/admin/categories", { sectionCode: "items", name: "аксессуары" });
    assert.equal(dup.statusCode, 409);

    const item = await call("POST", "/v1/admin/catalog-items", { categoryId: childId, name: "Солнцезащитные очки", aliases: ["очки от солнца"] });
    assert.equal(item.statusCode, 201);

    const search = await call("GET", `/v1/admin/catalog-items?query=${encodeURIComponent("солнца")}`);
    assert.equal((search.json() as { items: unknown[] }).items.length, 1, "поиск по синонимам");

    const notEmpty = await call("DELETE", `/v1/admin/categories/${rootId}`);
    assert.equal(notEmpty.statusCode, 409);

    const hide = await call("PATCH", `/v1/admin/categories/${rootId}`, { isActive: false });
    assert.equal(hide.statusCode, 200);
    const catalog = await env.app.inject({ method: "GET", url: "/v1/catalog" });
    const visible = (catalog.json() as { categories: CategoryDto[] }).categories;
    assert.ok(!visible.some((c) => c.id === rootId || c.id === childId), "скрытая категория и её подкатегории не видны");
  });

  test("конструктор полей: создание, проверка, правка, публичный список", async () => {
    const types = (await call("GET", "/v1/admin/listing-types")).json() as { items: ListingTypeDto[] };
    const vehicle = types.items.find((t) => t.code === "vehicle")!;

    const speed = await call("POST", "/v1/admin/attributes", {
      listingTypeId: vehicle.id,
      key: "max_speed",
      label: "Максимальная скорость",
      dataType: "number",
      unit: "км/ч",
      minValue: 0,
      maxValue: 500,
      filterable: true,
    });
    assert.equal(speed.statusCode, 201);
    const speedDto = speed.json() as AttributeDefinitionDto;
    assert.equal(speedDto.maxValue, 500);

    const dupKey = await call("POST", "/v1/admin/attributes", {
      listingTypeId: vehicle.id,
      key: "max_speed",
      label: "Ещё скорость",
      dataType: "number",
    });
    assert.equal(dupKey.statusCode, 409);

    const noOptions = await call("POST", "/v1/admin/attributes", {
      listingTypeId: vehicle.id,
      key: "body",
      label: "Кузов",
      dataType: "select",
    });
    assert.equal(noOptions.statusCode, 400);

    const body = await call("POST", "/v1/admin/attributes", {
      listingTypeId: vehicle.id,
      key: "body",
      label: "Кузов",
      dataType: "select",
      options: ["Седан", "Купе"],
      required: true,
    });
    assert.equal(body.statusCode, 201);
    const bodyId = (body.json() as AttributeDefinitionDto).id;

    const edit = await call("PATCH", `/v1/admin/attributes/${bodyId}`, { options: ["Седан", "Купе", "Хэтчбек"], isActive: false });
    assert.equal(edit.statusCode, 200);
    assert.deepEqual((edit.json() as AttributeDefinitionDto).options, ["Седан", "Купе", "Хэтчбек"]);

    const publicList = await env.app.inject({ method: "GET", url: `/v1/catalog/attributes?listingTypeId=${vehicle.id}` });
    const keys = (publicList.json() as { items: AttributeDefinitionDto[] }).items.map((a) => a.key);
    assert.deepEqual(keys, ["max_speed"], "скрытое поле не попадает в приложение");

    // Шаг и привязка к категориям: категории только из раздела этого типа.
    const itemsCategory = (await call("POST", "/v1/admin/categories", { sectionCode: "items", name: "Одежда" })).json() as CategoryDto;
    const carsCategory = (await call("POST", "/v1/admin/categories", { sectionCode: "cars", name: "Легковые" })).json() as CategoryDto;
    const clearance = await call("POST", "/v1/admin/attributes", {
      listingTypeId: vehicle.id,
      key: "clearance",
      label: "Клиренс",
      dataType: "number",
      unit: "%",
      minValue: 5,
      maxValue: 100,
      stepValue: 5,
      categoryIds: [carsCategory.id],
    });
    assert.equal(clearance.statusCode, 201, clearance.body);
    const clearanceDto = clearance.json() as AttributeDefinitionDto;
    assert.equal(clearanceDto.stepValue, 5);
    assert.deepEqual(clearanceDto.categoryIds, [carsCategory.id]);

    const foreignCategory = await call("PATCH", `/v1/admin/attributes/${clearanceDto.id}`, { categoryIds: [itemsCategory.id] });
    assert.equal(foreignCategory.statusCode, 400);
    assert.ok(foreignCategory.json().fields.categoryIds);

    const cleared = await call("PATCH", `/v1/admin/attributes/${clearanceDto.id}`, { categoryIds: [], stepValue: null });
    assert.equal(cleared.statusCode, 200);
    assert.deepEqual((cleared.json() as AttributeDefinitionDto).categoryIds, []);
    assert.equal((cleared.json() as AttributeDefinitionDto).stepValue, null);
  });

  test("новый тип имущества и правка операций", async () => {
    const created = await call("POST", "/v1/admin/listing-types", {
      sectionCode: "notary",
      code: "garage",
      name: "Гараж",
      operations: ["sell", "sell"],
    });
    assert.equal(created.statusCode, 201);
    const type = created.json() as ListingTypeDto;
    assert.deepEqual(type.operations, ["sell"]);

    const patch = await call("PATCH", `/v1/admin/listing-types/${type.id}`, { operations: ["sell", "exchange"], maxImages: 4 });
    assert.equal(patch.statusCode, 200);
    assert.deepEqual((patch.json() as ListingTypeDto).operations, ["sell", "exchange"]);
    assert.equal((patch.json() as ListingTypeDto).maxImages, 4);
  });
});
