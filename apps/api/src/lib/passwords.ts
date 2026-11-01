import { hash, verify } from "@node-rs/argon2";

/**
 * Пароли хранятся только как хеш Argon2id с параметрами
 * из рекомендаций OWASP: 19 МиБ памяти, 2 прохода.
 */
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * Проверка пароля для несуществующего пользователя. Тратит столько же
 * времени, сколько настоящая, чтобы по скорости ответа нельзя было узнать,
 * зарегистрирован ли логин.
 */
export async function verifyDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  await verifyPassword(await dummyHash, password);
  return false;
}
