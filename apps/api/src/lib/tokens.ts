import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export interface AccessClaims {
  /** id пользователя */
  sub: string;
  /** id сессии */
  sid: string;
}

/**
 * Токен доступа: короткоживущий JWT (по умолчанию 15 минут).
 * Хранится в приложении только в памяти.
 */
export async function signAccessToken(claims: AccessClaims, secret: string, ttlMinutes: number): Promise<string> {
  return new SignJWT({ sid: claims.sid })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer("twm-market")
    .setExpirationTime(`${ttlMinutes}m`)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      issuer: "twm-market",
    });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
    return { sub: payload.sub, sid: payload.sid };
  } catch {
    return null;
  }
}

/** Refresh-токен: 32 случайных байта. В базе хранится только его SHA-256. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Шестизначный код для письма. */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Хеш кода с секретом сервера (HMAC). Без секрета миллион вариантов
 * перебирается мгновенно, поэтому простой SHA-256 здесь не годится.
 */
export function hashCode(code: string, secret: string): string {
  return createHmac("sha256", secret).update(code).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
