import { z } from "zod";

/**
 * Правила проверки данных аккаунта. Один и тот же код проверяет форму
 * в приложении (мгновенная подсказка) и запрос на сервере (защита).
 */

/** Логины, которые нельзя занять: их можно принять за администрацию. */
export const RESERVED_LOGINS: readonly string[] = [
  "admin",
  "administrator",
  "administration",
  "moderator",
  "moder",
  "support",
  "help",
  "system",
  "root",
  "twm",
  "twmmarket",
  "twm_market",
  "amazing",
  "amazingonline",
  "amazing_online",
  "official",
  "notary",
];

export const LOGIN_MIN = 3;
export const LOGIN_MAX = 24;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export const loginSchema = z
  .string({ required_error: "Введите логин" })
  .trim()
  .min(LOGIN_MIN, `Логин — от ${LOGIN_MIN} символов`)
  .max(LOGIN_MAX, `Логин — до ${LOGIN_MAX} символов`)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, "Только латинские буквы, цифры, «_», «.» и «-»; начинается с буквы или цифры")
  .refine((value) => !RESERVED_LOGINS.includes(value.toLowerCase()), "Этот логин зарезервирован");

export const emailSchema = z
  .string({ required_error: "Введите email" })
  .trim()
  .toLowerCase()
  .max(254, "Слишком длинный email")
  .email("Неверный формат email");

export const passwordSchema = z
  .string({ required_error: "Введите пароль" })
  .min(PASSWORD_MIN, `Пароль — от ${PASSWORD_MIN} символов`)
  .max(PASSWORD_MAX, `Пароль — до ${PASSWORD_MAX} символов`);

export const registerSchema = z
  .object({
    login: loginSchema,
    email: emailSchema,
    password: passwordSchema,
    rulesAccepted: z.literal(true, {
      errorMap: () => ({ message: "Нужно принять правила площадки" }),
    }),
  })
  .refine((data) => data.password.toLowerCase() !== data.login.toLowerCase(), {
    message: "Пароль не должен совпадать с логином",
    path: ["password"],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const signInSchema = z.object({
  /** Логин или email. */
  identifier: z.string({ required_error: "Введите логин или email" }).trim().min(1, "Введите логин или email").max(254),
  password: z.string({ required_error: "Введите пароль" }).min(1, "Введите пароль").max(PASSWORD_MAX),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const codeSchema = z
  .string({ required_error: "Введите код" })
  .trim()
  .regex(/^\d{6}$/, "Код — 6 цифр");

export const verifyEmailSchema = z.object({ code: codeSchema });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  email: emailSchema,
  code: codeSchema,
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Удаление аккаунта самим игроком: пароль и явное согласие. */
export const deleteAccountSchema = z.object({
  password: z.string({ required_error: "Введите пароль" }).min(1, "Введите пароль").max(PASSWORD_MAX),
  confirm: z.literal(true, { errorMap: () => ({ message: "Подтвердите, что понимаете последствия" }) }),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Введите текущий пароль").max(PASSWORD_MAX),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "Новый пароль совпадает с текущим",
    path: ["newPassword"],
  });

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(200),
});

/**
 * Игровой ник. Правила игры для ников нам не известны, поэтому проверка
 * мягкая: буквы (латиница и кириллица), цифры, «_», «.» и «-», без пробелов.
 */
export const gameNicknameSchema = z
  .string({ required_error: "Введите игровой ник" })
  .trim()
  .min(2, "Ник — от 2 символов")
  .max(32, "Ник — до 32 символов")
  .regex(/^[\p{L}\p{N}_.-]+$/u, "Только буквы, цифры, «_», «.» и «-», без пробелов");

export const createGameProfileSchema = z.object({
  nickname: gameNicknameSchema,
  serverNumber: z.number({ required_error: "Выберите сервер" }).int().positive(),
});
export type CreateGameProfileInput = z.infer<typeof createGameProfileSchema>;

export const updateGameProfileSchema = z.object({
  nickname: gameNicknameSchema,
});

/** Сколько игровых профилей может быть у одного аккаунта. */
export const MAX_GAME_PROFILES = 10;
/** Как часто можно менять ник в игровом профиле. */
export const NICKNAME_CHANGE_COOLDOWN_DAYS = 7;

/** Превращает ошибку zod в словарь «поле → первое сообщение». */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in result)) result[key] = issue.message;
  }
  return result;
}
