import { test } from "node:test";
import assert from "node:assert/strict";
import { routeFromDeepLink } from "./deep-link";

test("ссылка twm-market://listing/ID открывает объявление", () => {
  const id = "3f2b6c1e-8a4d-4f0e-9b1a-2c3d4e5f6a7b";
  assert.equal(routeFromDeepLink(`twm-market://listing/${id}`), `/listing/${id}`);
  assert.equal(routeFromDeepLink(`twm-market://listing/${id}/`), `/listing/${id}`);
  assert.equal(routeFromDeepLink(`TWM-MARKET://LISTING/${id.toUpperCase()}`), `/listing/${id}`);
});

test("чужие и испорченные ссылки игнорируются", () => {
  assert.equal(routeFromDeepLink("twm-market://listing/../../admin"), null);
  assert.equal(routeFromDeepLink("twm-market://admin/users"), null);
  assert.equal(routeFromDeepLink("https://evil.example/listing/3f2b6c1e-8a4d-4f0e-9b1a-2c3d4e5f6a7b"), null);
  assert.equal(routeFromDeepLink("twm-market://listing/3f2b6c1e-8a4d-4f0e-9b1a-2c3d4e5f6a7b?x=1"), null);
});
