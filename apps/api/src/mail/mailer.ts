import type { FastifyBaseLogger } from "fastify";

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
