import { test } from "node:test";
import assert from "node:assert/strict";
import { routeFromDeepLink } from "./deep-link";

test("ссылка twm-market://listing/ID открывает объявление", () => {
  const id = "3f2b6c1e-8a4d-4f0e-9b1a-2c3d4e5f6a7b";
  assert.equal(routeFromDeepLink(`twm-market://listing/${id}`), `/listing/${id}`);
  assert.equal(routeFromDeepLink(`twm-market://listing/${id}/`), `/listing/${id}`);
  assert.equal(routeFromDeepLink(`TWM-MARKET://LISTING/${id.toUpperCase()}`), `/listing/${id}`);
});

test("ссылка twm-market.ru/l/ID (App Links на Android) открывает объявление", () => {
  const id = "3f2b6c1e-8a4d-4f0e-9b1a-2c3d4e5f6a7b";
  assert.equal(routeFromDeepLink(`https://twm-market.ru/l/${id}`), `/listing/${id}`);
  assert.equal(routeFromDeepLink(`https://www.twm-market.ru/l/${id}/`), `/listing/${id}`);
  assert.equal(routeFromDeepLink(`https://twm-market.ru/l/${id}?utm_source=tg`), `/listing/${id}`);
});

test("чужие и испорченные ссылки игнорируются", () => {
  assert.equal(routeFromDeepLink("http://twm-market.ru/l/3f2b6c1e-8a4d-4f0e-9b1a-2c3d4e5f6a7b"), null);
  assert.equal(routeFromDeepLink("https://twm-market.ru.evil.example/l/3f2b6c1e-8a4d-4f0e-9b1a-2c3d4e5f6a7b"), null);
  assert.equal(routeFromDeepLink("https://twm-market.ru/rules/"), null);
  assert.equal(routeFromDeepLink("https://twm-market.ru/l/../admin"), null);
  assert.equal(routeFromDeepLink("twm-market://listing/../../admin"), null);
  assert.equal(routeFromDeepLink("twm-market://admin/users"), null);
  assert.equal(routeFromDeepLink("https://evil.example/listing/3f2b6c1e-8a4d-4f0e-9b1a-2c3d4e5f6a7b"), null);
  assert.equal(routeFromDeepLink("twm-market://listing/3f2b6c1e-8a4d-4f0e-9b1a-2c3d4e5f6a7b?x=1"), null);
});

test("уведомление Android открывает экран из белого списка", () => {
  const id = "3f2b6c1e-8a4d-4f0e-9b1a-2c3d4e5f6a7b";
  assert.equal(routeFromDeepLink(`twm-market://open/chats/${id}`), `/chats/${id}`);
  assert.equal(routeFromDeepLink("twm-market://open/my/listings"), "/my/listings");
  assert.equal(routeFromDeepLink("twm-market://open/admin/moderation"), "/admin/moderation");
  assert.equal(routeFromDeepLink("twm-market://open/account"), "/account");
  assert.equal(routeFromDeepLink("twm-market://open/feedback"), "/feedback");
  assert.equal(routeFromDeepLink("twm-market://open/../../etc"), null);
  assert.equal(routeFromDeepLink("twm-market://open/settings/delete"), null);
  assert.equal(routeFromDeepLink("twm-market://open/"), null);
});

