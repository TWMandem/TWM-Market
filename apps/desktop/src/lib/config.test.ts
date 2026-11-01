import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeApiUrl } from "./config.js";

test("адрес API приводится к единому виду", () => {
  assert.equal(normalizeApiUrl("https://api.example.com/"), "https://api.example.com");
  assert.equal(normalizeApiUrl("  http://localhost:3000  "), "http://localhost:3000");
  assert.equal(normalizeApiUrl("https://example.com/api/"), "https://example.com/api");
});

test("неверный адрес заменяется адресом по умолчанию", () => {
  assert.equal(normalizeApiUrl(undefined), "http://localhost:3000");
  assert.equal(normalizeApiUrl(""), "http://localhost:3000");
  assert.equal(normalizeApiUrl("not a url"), "http://localhost:3000");
  assert.equal(normalizeApiUrl("file:///C:/evil"), "http://localhost:3000");
});
