import webpush from "web-push";
import type { Sql } from "../db/client.js";

/**
 * Web Push: уведомления веб-приложению (iPhone, добавленный «На экран Домой»,
 * и браузеры). Браузер выдаёт подписку — адрес своей службы уведомлений
 * (Apple, Google, Mozilla) и ключи; сервер шифрует уведомление этими ключами
 * и отправляет туда, подписывая запрос своими ключами VAPID.
 *
 * Ключи VAPID создаются один раз при первой надобности и хранятся в базе:
 * настраивать ничего не нужно. Если их сменить, старые подписки перестанут
 * работать — поэтому они не меняются.
 */

export interface WebPushPayload {
  id: number;
  title: string;
  body: string;
  link: string | null;
}

export interface WebSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Службы уведомлений браузеров: подписка на другой адрес не принимается (защита от SSRF). */
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

export function allowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

let cached: { publicKey: string; privateKey: string } | null = null;

export async function vapidKeys(sql: Sql): Promise<{ publicKey: string; privateKey: string }> {
  if (cached) return cached;
  const [row] = await sql<{ publicKey: string; privateKey: string }[]>`SELECT public_key, private_key FROM web_push_keys WHERE id = 1`;
  if (row) {
    cached = row;
    return row;
  }
  const fresh = webpush.generateVAPIDKeys();
  // Два процесса могли создать ключи одновременно — остаются те, что записались первыми.
  await sql`INSERT INTO web_push_keys (id, public_key, private_key) VALUES (1, ${fresh.publicKey}, ${fresh.privateKey}) ON CONFLICT (id) DO NOTHING`;
  const [saved] = await sql<{ publicKey: string; privateKey: string }[]>`SELECT public_key, private_key FROM web_push_keys WHERE id = 1`;
  cached = saved!;
  return cached;
}

/** Отправка одного уведомления; в тестах подменяется. Возвращает код ответа службы. */
export type Transport = (subscription: WebSubscription, body: string, keys: { publicKey: string; privateKey: string }) => Promise<number>;

const defaultTransport: Transport = async (subscription, body, keys) => {
  try {
    const result = await webpush.sendNotification(subscription, body, {
      TTL: 60 * 60 * 24,
      urgency: "high",
      vapidDetails: { subject: "mailto:support@twm-market.ru", publicKey: keys.publicKey, privateKey: keys.privateKey },
      timeout: 10_000,
    });
    return result.statusCode;
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === "number") return status;
    throw error;
  }
};

let transport: Transport = defaultTransport;

/** Только для тестов. */
export function setWebPushTransport(next: Transport | null): void {
  transport = next ?? defaultTransport;
}

/**
 * Разослать уведомление на все веб-устройства игрока. Подписки, которые
 * служба больше не принимает (404/410 — игрок отписался или удалил
 * приложение), удаляются. Ошибки не выбрасываются: уведомление в приложении
 * уже сохранено.
 */
export async function sendWebPush(sql: Sql, userId: string, payload: WebPushPayload): Promise<number> {
  try {
    const devices = await sql<{ id: string; subscription: WebSubscription }[]>`
      SELECT d.id, d.subscription FROM push_devices d JOIN users u ON u.id = d.user_id
      WHERE d.user_id = ${userId} AND d.platform = 'web' AND d.subscription IS NOT NULL AND u.status = 'active'`;
    if (devices.length === 0) return 0;
    const keys = await vapidKeys(sql);
    const body = JSON.stringify({ ...payload, title: payload.title.slice(0, 120), body: payload.body.slice(0, 300) });
    let sent = 0;
    await Promise.all(
      devices.map(async (device) => {
        try {
          const status = await transport(device.subscription, body, keys);
          if (status === 404 || status === 410) {
            await sql`DELETE FROM push_devices WHERE id = ${device.id}`;
          } else if (status >= 200 && status < 300) {
            sent += 1;
            await sql`UPDATE push_devices SET last_seen_at = now() WHERE id = ${device.id}`;
          }
        } catch {
          // Служба недоступна — уведомление останется в приложении.
        }
      }),
    );
    return sent;
  } catch {
    return 0;
  }
}
