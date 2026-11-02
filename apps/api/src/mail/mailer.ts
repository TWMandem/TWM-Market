import type { FastifyBaseLogger } from "fastify";
import nodemailer, { type Transporter } from "nodemailer";
import type { Config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { signV4 } from "./sigv4.js";

type ErrorLog = Pick<FastifyBaseLogger, "error">;
const mailUnavailable = () =>
  new AppError(503, "mail_unavailable", "Не удалось отправить письмо. Попробуйте ещё раз через минуту.");

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
      throw mailUnavailable();
    }
  }

  /** Проверка подключения при запуске сервера: ошибка в настройках видна сразу. */
  async verify(): Promise<void> {
    await this.transport.verify();
  }
}

export interface PostboxOptions {
  endpoint: string;
  keyId: string;
  secret: string;
  from: string;
}

/**
 * Yandex Cloud Postbox: письмо уходит HTTPS-запросом (API как у Amazon SES v2),
 * поэтому закрытые почтовые порты на VPS не мешают.
 */
export class PostboxMailer implements Mailer {
  constructor(
    private readonly options: PostboxOptions,
    private readonly log: ErrorLog,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Тело запроса SendEmail. Вынесено отдельно ради проверки в тестах. */
  static body(from: string, message: MailMessage): string {
    return JSON.stringify({
      FromEmailAddress: from,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: "UTF-8" },
          Body: { Text: { Data: message.text, Charset: "UTF-8" } },
        },
      },
    });
  }

  async send(message: MailMessage): Promise<void> {
    const url = new URL("/v2/email/outbound-emails", this.options.endpoint);
    const body = PostboxMailer.body(this.options.from, message);
    const headers = signV4({
      method: "POST",
      url,
      headers: { "content-type": "application/json" },
      body,
      accessKeyId: this.options.keyId,
      secretAccessKey: this.options.secret,
      region: "ru-central1",
      service: "ses",
    });
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      this.log.error({ err: error, to: message.to }, "Postbox недоступен");
      throw mailUnavailable();
    }
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      this.log.error({ status: response.status, details: details.slice(0, 500), to: message.to }, "Postbox не принял письмо");
      throw mailUnavailable();
    }
  }
}

/** Почта по настройкам сервера. Для console возвращает null — письма пишутся в журнал. */
export function createMailer(config: Config, log: ErrorLog): SmtpMailer | PostboxMailer | null {
  if (config.MAIL_TRANSPORT === "postbox") {
    return new PostboxMailer(
      { endpoint: config.POSTBOX_ENDPOINT, keyId: config.POSTBOX_KEY_ID!, secret: config.POSTBOX_SECRET!, from: config.MAIL_FROM! },
      log,
    );
  }
  if (config.MAIL_TRANSPORT === "smtp") {
    return new SmtpMailer(
      {
        host: config.SMTP_HOST!,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        user: config.SMTP_USER!,
        pass: config.SMTP_PASS!,
        from: config.MAIL_FROM ?? `TWM Market <${config.SMTP_USER}>`,
      },
      log,
    );
  }
  return null;
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
