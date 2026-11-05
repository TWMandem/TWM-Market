import { test } from "node:test";
import assert from "node:assert/strict";
import { describeDevice } from "./device-name";

const WIN_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
const ANDROID_WV = "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

test("устройство: версия TWM Market и система", () => {
  assert.equal(describeDevice(`${WIN_EDGE} TWMClient/windows`), "Приложение · Windows");
  assert.equal(describeDevice(`${ANDROID_WV} TWMClient/android`), "Приложение · Android");
  assert.equal(describeDevice(`${IPHONE} TWMClient/web`), "Веб-версия · iPhone");
  assert.equal(describeDevice(`${MAC_CHROME} TWMClient/web`), "Веб-версия · macOS");
  assert.equal(describeDevice(MAC_CHROME), "Браузер · macOS");
  // Входы из старых версий без отметки.
  assert.equal(describeDevice(WIN_EDGE), "Приложение · Windows");
  assert.equal(describeDevice(ANDROID_WV), "Приложение · Android");
  assert.equal(describeDevice(null), "Неизвестное устройство");
});
