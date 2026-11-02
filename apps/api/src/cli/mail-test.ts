/**
 * Проверка почты на сервере: отправляет тестовое письмо по текущим настройкам.
 *
 *   sudo twm mail-test you@example.com
 */
import { loadConfig } from "../config.js";
import { createMailer } from "../mail/mailer.js";

const to = process.argv[2];
if (!to || !to.includes("@")) {
  console.error("Укажите адрес: twm mail-test you@example.com");
  process.exit(1);
}

const config = loadConfig();
const mailer = createMailer(config, console);
if (!mailer) {
  console.error("Почта не настроена (MAIL_TRANSPORT=console): письма пишутся только в журнал сервера.");
  process.exit(1);
}

try {
  await mailer.send({
    to,
    subject: "TWM Market: проверка почты",
    text: "Это тестовое письмо с сервера TWM Market. Если вы его видите, отправка кодов подтверждения работает.",
  });
  console.log(`Письмо отправлено на ${to} (${config.MAIL_TRANSPORT}). Проверьте входящие и папку «Спам».`);
} catch {
  console.error("Письмо не отправлено — подробности выше.");
  process.exit(1);
}
