import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32Decode,
  base32Encode,
  currentStep,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  totpAt,
  verifyTotp,
} from "./totp.js";

// Контрольные значения из RFC 6238 (приложение B) для SHA1, секрет «12345678901234567890».
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

test("коды совпадают с примерами RFC 6238", () => {
  const cases: Array<[number, string]> = [
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ];
  for (const [seconds, code] of cases) {
    assert.equal(totpAt(RFC_SECRET, Math.floor(seconds / 30)), code, `t=${seconds}`);
  }
});

test("base32 туда и обратно", () => {
  const bytes = Buffer.from("TWM Market — 2FA");
  assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  assert.equal(generateTotpSecret().length, 32);
});

test("допуск ±1 шаг и защита от повторного использования", () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  const step = currentStep(now);

  assert.equal(verifyTotp(secret, totpAt(secret, step), null, now), step);
  assert.equal(verifyTotp(secret, totpAt(secret, step - 1), null, now), step - 1);
  assert.equal(verifyTotp(secret, totpAt(secret, step - 3), null, now), null, "слишком старый код");
  assert.equal(verifyTotp(secret, totpAt(secret, step), step, now), null, "этот шаг уже использован");
  assert.equal(verifyTotp(secret, "12345", null, now), null);
});

test("секрет шифруется и не расшифровывается чужим ключом", () => {
  const sealed = encryptSecret("JBSWY3DPEHPK3PXP", "server-secret-a".repeat(3));
  assert.ok(!sealed.includes("JBSWY3DPEHPK3PXP"));
  assert.equal(decryptSecret(sealed, "server-secret-a".repeat(3)), "JBSWY3DPEHPK3PXP");
  assert.throws(() => decryptSecret(sealed, "server-secret-b".repeat(3)));
});
