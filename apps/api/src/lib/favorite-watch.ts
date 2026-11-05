import { formatPrice } from "@twm/shared";
import type { Sql } from "../db/client.js";
import { sendWebPush } from "./web-push.js";

/**
 * Слежение за избранным. Игрок добавил объявление в избранное — сообщаем ему,
 * когда оно стало выгоднее (продажа подешевела, скупка подорожала), когда его
 * сняли (продано, снято, истёк срок, снято модератором) и когда оно вернулось.
 *
 * Чтобы не засыпать игрока уведомлениями, в избранном хранится, о чём ему уже
 * сообщили: лучшая цена и состояние «в продаже» / «снято».
 *  • о цене — только если она лучше уже известной хотя бы на 1 %, не чаще раза в 3 часа;
 *  • о снятии — только если игрок знает объявление как активное, не чаще раза в 12 часов;
 *  • о возвращении — только если перед этим сообщили о снятии.
 * Владельцу объявления, заблокированным игрокам и тем, кто отключил такие
 * уведомления в личном кабинете, ничего не приходит (но отметки обновляются,
 * чтобы после включения не пришли старые новости).
 */

const PRICE_PAUSE = "3 hours";
const STATUS_PAUSE = "12 hours";
/** Минимальное улучшение цены для уведомления: 1 %. */
const MIN_CHANGE = 0.01;

export type ClosedReason = "sold" | "withdrawn" | "archived" | "removed";

const CLOSED_TEXT: Record<ClosedReason, { title: string; body: (t: string) => string }> = {
  sold: { title: "Сделка состоялась", body: (t) => `«${t}» больше недоступно. Посмотрите похожие объявления.` },
  withdrawn: { title: "Снято с публикации", body: (t) => `Продавец снял «${t}». Если опубликует снова — сообщим.` },
  archived: { title: "Срок объявления истёк", body: (t) => `«${t}» ушло в архив. Если продавец его продлит — сообщим.` },
  removed: { title: "Объявление недоступно", body: (t) => `«${t}» больше не опубликовано.` },
};

interface Delivery {
  userId: string;
  kind: "favorite_price" | "favorite_closed" | "favorite_back";
  title: string;
  body: string;
  link: string;
}

async function deliver(sql: Sql, items: Delivery[]): Promise<number> {
  if (items.length === 0) return 0;
  const rows = items.map((d) => ({ user_id: d.userId, kind: d.kind, title: d.title.slice(0, 120), body: d.body.slice(0, 300), link: d.link }));
  const saved = (await sql`
    INSERT INTO notifications ${sql(rows, "user_id", "kind", "title", "body", "link")}
    RETURNING id, user_id, title, body, link`) as unknown as Array<{ id: string; userId: string; title: string; body: string; link: string | null }>;
  // Веб-приложению (iPhone) — сразу через Web Push, без ожидания.
  for (const n of saved) void sendWebPush(sql, n.userId, { id: Number(n.id), title: n.title, body: n.body, link: n.link });
  return items.length;
}

/** Получит ли игрок уведомление (условие для RETURNING; f — избранное, l — объявление, u — игрок). */
const eligible = (sql: Sql) => sql`
  (u.status = 'active' AND u.notify_favorites
   AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.user_id = f.user_id AND b.blocked_id = l.user_id)) AS eligible`;

const percent = (from: number, to: number) => Math.round((Math.abs(to - from) / from) * 100);

/**
 * Цена активного объявления изменилась. Сообщает тем, для кого она стала
 * лучше известной. Возвращает число отправленных уведомлений.
 */
export async function watchPrice(sql: Sql, listingId: string): Promise<number> {
  const rows = await sql<
    { userId: string; title: string; operation: string; price: string; old: string | null; eligible: boolean }[]
  >`
    UPDATE favorites f SET notified_price = l.price,
      price_notified_at = CASE WHEN o.old IS NULL THEN f.price_notified_at ELSE now() END
    FROM listings l, users u,
      (SELECT user_id, notified_price AS old FROM favorites WHERE listing_id = ${listingId} FOR UPDATE) o
    WHERE f.listing_id = ${listingId} AND l.id = f.listing_id AND u.id = f.user_id AND o.user_id = f.user_id
      AND l.status = 'active' AND l.price IS NOT NULL AND l.operation IN ('sell', 'buy')
      AND f.user_id <> l.user_id AND f.notified_state = 'active'
      AND (
        o.old IS NULL
        OR (
          (f.price_notified_at IS NULL OR f.price_notified_at < now() - ${PRICE_PAUSE}::interval)
          AND (
            (l.operation = 'sell' AND l.price <= o.old - ceil(o.old * ${MIN_CHANGE}::numeric))
            OR (l.operation = 'buy' AND l.price >= o.old + ceil(o.old * ${MIN_CHANGE}::numeric))
          )
        )
      )
    RETURNING f.user_id, l.title, l.operation, l.price, o.old, ${eligible(sql)}`;

  return deliver(
    sql,
    rows
      .filter((r) => r.eligible && r.old !== null)
      .map((r) => {
        const from = Number(r.old);
        const to = Number(r.price);
        const sell = r.operation === "sell";
        return {
          userId: r.userId,
          kind: "favorite_price",
          title: `${sell ? "Подешевело" : "Скупка дороже"}: ${r.title}`,
          body: sell
            ? `Было ${formatPrice(from)}, стало ${formatPrice(to)} (−${percent(from, to)}%).`
            : `Готовы заплатить до ${formatPrice(to)} вместо ${formatPrice(from)} (+${percent(from, to)}%).`,
          link: `/listing/${listingId}`,
        };
      }),
  );
}

/** Объявления сняты с публикации. Сообщает тем, кто знает их как активные. */
export async function watchClosed(sql: Sql, listingIds: string[], reason: ClosedReason): Promise<number> {
  if (listingIds.length === 0) return 0;
  const rows = await sql<{ userId: string; listingId: string; title: string; eligible: boolean }[]>`
    UPDATE favorites f SET notified_state = 'closed', status_notified_at = now()
    FROM listings l, users u
    WHERE f.listing_id IN ${sql(listingIds)} AND l.id = f.listing_id AND u.id = f.user_id
      AND f.user_id <> l.user_id AND f.notified_state = 'active'
      AND (f.status_notified_at IS NULL OR f.status_notified_at < now() - ${STATUS_PAUSE}::interval)
    RETURNING f.user_id, l.id AS listing_id, l.title, ${eligible(sql)}`;
  const text = CLOSED_TEXT[reason];
  return deliver(
    sql,
    rows
      .filter((r) => r.eligible)
      .map((r) => ({ userId: r.userId, kind: "favorite_closed", title: `${text.title}: ${r.title}`, body: text.body(r.title), link: `/listing/${r.listingId}` })),
  );
}

/** Объявление снова активно. Сообщает тем, кому сообщили о снятии; лучшая цена обновляется. */
export async function watchBack(sql: Sql, listingId: string): Promise<number> {
  const rows = await sql<{ userId: string; title: string; operation: string; price: string | null; old: string | null; eligible: boolean }[]>`
    UPDATE favorites f SET notified_state = 'active', status_notified_at = now(),
      notified_price = CASE
        WHEN l.price IS NULL THEN o.old
        WHEN o.old IS NULL THEN l.price
        WHEN l.operation = 'buy' THEN GREATEST(o.old, l.price)
        ELSE LEAST(o.old, l.price)
      END
    FROM listings l, users u,
      (SELECT user_id, notified_price AS old FROM favorites WHERE listing_id = ${listingId} FOR UPDATE) o
    WHERE f.listing_id = ${listingId} AND l.id = f.listing_id AND u.id = f.user_id AND o.user_id = f.user_id
      AND l.status = 'active' AND f.user_id <> l.user_id AND f.notified_state = 'closed'
    RETURNING f.user_id, l.title, l.operation, l.price, o.old, ${eligible(sql)}`;

  return deliver(
    sql,
    rows
      .filter((r) => r.eligible)
      .map((r) => {
        const price = r.price === null ? null : Number(r.price);
        const old = r.old === null ? null : Number(r.old);
        const better =
          price !== null && old !== null && (r.operation === "buy" ? price > old : price < old) ? ` — выгоднее, чем было (${formatPrice(old)})` : "";
        return {
          userId: r.userId,
          kind: "favorite_back",
          title: `Снова доступно: ${r.title}`,
          body: price === null ? "Объявление снова опубликовано." : `Объявление снова опубликовано. Цена ${formatPrice(price)}${better}.`,
          link: `/listing/${listingId}`,
        };
      }),
  );
}

/**
 * Уведомления — дополнение: если что-то пошло не так, основное действие
 * (публикация, правка) уже выполнено и не должно падать.
 */
export function watchSafely(task: Promise<unknown>, log: { error: (obj: unknown, msg?: string) => void }): Promise<void> {
  return task.then(
    () => undefined,
    (error: unknown) => log.error(error, "Уведомления по избранному не отправлены"),
  );
}
