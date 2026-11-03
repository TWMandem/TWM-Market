import { createHmac } from "node:crypto";

export const API = process.env.API_URL ?? "http://localhost:3000";
export const UI = process.env.UI_URL ?? "http://localhost:4173";
export const OUT = new URL("./out/", import.meta.url).pathname;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(input) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Код TOTP (6 цифр, 30 секунд) — как в приложении-аутентификаторе. */
export function totp(secret, now = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}
