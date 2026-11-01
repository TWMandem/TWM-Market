import type { FastifyBaseLogger } from "fastify";
import nodemailer, { type Transporter } from "nodemailer";
import { AppError } from "../lib/errors.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Письма для разработки: вместо отправки выводятся в журнал сервера.
 * Настоящий почтовый сервис подключим вместе с выбором хостинга.
 */
export class ConsoleMailer implements Mailer {
  constructor(private readonly log: Pick<FastifyBaseLogger, "info">) {}

  async send(message: MailMessage): Promise<void> {
    this.log.info({ mail: message }, `Письмо для ${message.to}: ${message.subject}`);
  }
}

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/** Настоящая отправка через SMTP (например, почту Яндекса с паролем приложения). */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    private readonly options: SmtpOptions,
    private readonly log: Pick<FastifyBaseLogger, "error">,
  ) {
    this.transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: { user: options.user, pass: options.pass },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transport.sendMail({ from: this.options.from, to: message.to, subject: message.subject, text: message.text });
    } catch (error) {
      this.log.error({ err: error, to: message.to }, "Не удалось отправить письмо");
      throw new AppError(503, "mail_unavailable", "Не удалось отправить письмо. Попробуйте ещё раз через минуту.");
    }
  }

  /** Проверка подключения при запуске сервера: ошибка в настройках видна сразу. */
  async verify(): Promise<void> {
    await this.transport.verify();
  }
}

/** Почта для тестов: письма складываются в массив. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  /** Код из последнего письма на этот адрес. */
  lastCode(to: string): string | null {
    const message = [...this.sent].reverse().find((m) => m.to === to);
    return message?.text.match(/\b(\d{6})\b/)?.[1] ?? null;
  }
}

export const mailTemplates = {
  verifyEmail: (login: string, code: string): Omit<MailMessage, "to"> => ({
    subject: `Код подтверждения TWM Market: ${code}`,
    text: [
      `Здравствуйте, ${login}!`,
      "",
      `Ваш код подтверждения email: ${code}`,
      "Код действует 15 минут. Введите его в приложении TWM Market.",
      "",
      "Если вы не регистрировались на TWM Market, просто проигнорируйте это письмо.",
    ].join("\n"),
  }),
  resetPassword: (login: string, code: string): Omit<MailMessage, "to"> => ({
    subject: `Сброс пароля TWM Market: ${code}`,
    text: [
      `Здравствуйте, ${login}!`,
      "",
      `Код для сброса пароля: ${code}`,
      "Код действует 15 минут. После смены пароля все устройства будут отключены от аккаунта.",
      "",
      "Если вы не запрашивали сброс, ничего не делайте: пароль останется прежним.",
      "Сотрудники TWM Market никогда не спрашивают этот код.",
    ].join("\n"),
  }),
};
