/**
 * Создание администратора площадки. Запускается только на сервере:
 *
 *   pnpm --filter @twm/api admin:create -- --login admin_max --email you@example.com
 *
 * Пароль запрашивается с клавиатуры (ввод скрыт) или берётся из
 * переменной окружения ADMIN_PASSWORD. Через приложение стать
 * администратором нельзя: роль выдаётся только этой командой
 * или другим суперадминистратором (шаг 3).
 */
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { emailSchema, passwordSchema, type Role } from "@twm/shared";
import { z } from "zod";
import { createDatabase, uniqueViolation } from "../db/client.js";
import { migrate } from "../db/migrate.js";
import { hashPassword } from "../lib/passwords.js";

// Здесь логин проверяется без списка зарезервированных слов:
// администратору можно назвать себя, например, admin_max.
const adminLoginSchema = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, "Только латинские буквы, цифры, «_», «.» и «-»");

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    output._writeToOutput = (s: string) => {
      if (!muted) output.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      login: { type: "string" },
      email: { type: "string" },
      role: { type: "string", default: "superadmin" },
    },
  });

  const login = adminLoginSchema.parse(values.login);
  const email = emailSchema.parse(values.email);
  const role = z.enum(["moderator", "admin", "superadmin"]).parse(values.role) satisfies Role;

  const password = process.env.ADMIN_PASSWORD ?? (await askHidden("Пароль администратора: "));
  passwordSchema.parse(password);
  if (!process.env.ADMIN_PASSWORD) {
    const repeat = await askHidden("Повторите пароль: ");
    if (repeat !== password) throw new Error("Пароли не совпадают");
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Не задан DATABASE_URL");
  const database = createDatabase(url, { max: 1 });
  try {
    await migrate(database.sql);
    const passwordHash = await hashPassword(password);
    await database.sql`
      INSERT INTO users (login, email, password_hash, role, email_verified_at)
      VALUES (${login}, ${email}, ${passwordHash}, ${role}, now())`;
    console.log(`Готово: создан ${role} «${login}». Включите для него двухфакторный вход, когда она появится (шаг 3).`);
  } catch (error) {
    if (uniqueViolation(error) !== null) throw new Error("Пользователь с таким логином или email уже существует");
    throw error;
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof z.ZodError ? error.issues.map((i) => `${i.path.join(".") || "значение"}: ${i.message}`).join("\n") : String((error as Error).message ?? error);
  console.error(`Ошибка: ${message}`);
  process.exit(1);
});
