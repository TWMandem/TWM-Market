import type { ConversationDto, DealDto, MediaDto, MessageDto, MessageKind, ReviewDto } from "@twm/shared";
import type { Sql } from "../../db/client.js";
import { AppError, errors } from "../../lib/errors.js";
import { mediaUrl } from "../../lib/media.js";

/** Строка переписки со всем, что нужно для списка и шапки диалога. */
export interface ConversationRow {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  lastMessageAt: Date;
  listingTitle: string;
  listingPrice: string | null;
  listingOperation: "sell" | "buy" | "exchange";
  listingStatus: ConversationDto["listing"]["status"];
  serverNumber: number;
  serverName: string;
  serverColor: string;
  mainThumb: string | null;
  itemIconPath: string | null;
  itemIconKind: "image" | "video" | null;
  buyerLogin: string;
  sellerLogin: string;
  buyerLastSeen: Date | null;
  sellerLastSeen: Date | null;
  /** Кто кого заблокировал: by_me / by_them / null. */
  blocked: "by_me" | "by_them" | null;
  sellerNickname: string;
  buyerNickname: string | null;
  lastKind: MessageKind | null;
  lastBody: string | null;
  lastSenderId: string | null;
  lastCreatedAt: Date | null;
  lastHidden: boolean | null;
  unread: number;
  dealId: string | null;
  dealStatus: DealDto["status"] | null;
  dealProposedBy: string | null;
  dealProposedAt: Date | null;
  dealConfirmedAt: Date | null;
}

export function conversationSelect(sql: Sql, viewerId: string) {
  return sql`
    SELECT
      c.id, c.listing_id, c.buyer_id, c.seller_id, c.last_message_at,
      l.title AS listing_title, l.price AS listing_price, l.operation AS listing_operation, l.status AS listing_status,
      sv.number AS server_number, sv.name AS server_name, sv.color AS server_color,
      mi.thumb_path AS main_thumb, ci.icon_path AS item_icon_path, ci.icon_kind AS item_icon_kind,
      bu.login AS buyer_login, su.login AS seller_login, gp.nickname AS seller_nickname,
      CASE WHEN bu.show_online THEN bu.last_seen_at END AS buyer_last_seen,
      CASE WHEN su.show_online THEN su.last_seen_at END AS seller_last_seen,
      CASE
        WHEN EXISTS (SELECT 1 FROM user_blocks ub WHERE ub.user_id = ${viewerId}
          AND ub.blocked_id = CASE WHEN c.buyer_id = ${viewerId} THEN c.seller_id ELSE c.buyer_id END) THEN 'by_me'
        WHEN EXISTS (SELECT 1 FROM user_blocks ub WHERE ub.blocked_id = ${viewerId}
          AND ub.user_id = CASE WHEN c.buyer_id = ${viewerId} THEN c.seller_id ELSE c.buyer_id END) THEN 'by_them'
      END AS blocked,
      (SELECT bgp.nickname FROM game_profiles bgp
        WHERE bgp.user_id = c.buyer_id AND bgp.server_id = l.server_id AND bgp.archived_at IS NULL
        ORDER BY bgp.created_at LIMIT 1) AS buyer_nickname,
      lm.kind AS last_kind, lm.body AS last_body, lm.sender_id AS last_sender_id, lm.created_at AS last_created_at,
      (lm.hidden_at IS NOT NULL) AS last_hidden,
      (SELECT count(*)::int FROM messages m
        WHERE m.conversation_id = c.id AND m.sender_id IS DISTINCT FROM ${viewerId}
          AND m.created_at > CASE WHEN c.buyer_id = ${viewerId} THEN c.buyer_last_read_at ELSE c.seller_last_read_at END
      ) AS unread,
      d.id AS deal_id, d.status AS deal_status, d.proposed_by AS deal_proposed_by,
      d.proposed_at AS deal_proposed_at, d.confirmed_at AS deal_confirmed_at
    FROM conversations c
    JOIN listings l ON l.id = c.listing_id
    JOIN servers sv ON sv.id = l.server_id
    JOIN game_profiles gp ON gp.id = l.game_profile_id
    JOIN users bu ON bu.id = c.buyer_id
    JOIN users su ON su.id = c.seller_id
    LEFT JOIN catalog_items ci ON ci.id = l.catalog_item_id
    LEFT JOIN LATERAL (
      SELECT i.thumb_path FROM listing_images i
      WHERE i.listing_id = l.id ORDER BY i.is_main DESC, i.sort_order, i.created_at LIMIT 1
    ) mi ON true
    LEFT JOIN LATERAL (
      SELECT m.kind, m.body, m.sender_id, m.created_at, m.hidden_at FROM messages m
      WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1
    ) lm ON true
    LEFT JOIN deals d ON d.conversation_id = c.id`;
}

interface ReviewRow {
  id: string;
  dealId: string;
  authorId: string;
  positive: boolean;
  comment: string;
  authorLogin: string;
  listingTitle: string;
  createdAt: Date;
}

export const toReview = (r: ReviewRow): ReviewDto => ({
  id: r.id,
  positive: r.positive,
  comment: r.comment,
  author: { login: r.authorLogin },
  listingTitle: r.listingTitle,
  createdAt: r.createdAt.toISOString(),
});

export function reviewSelect(sql: Sql) {
  return sql`
    SELECT r.id, r.deal_id, r.author_id, r.positive, r.comment, r.created_at,
           u.login AS author_login, l.title AS listing_title
    FROM reviews r
    JOIN users u ON u.id = r.author_id
    JOIN deals d ON d.id = r.deal_id
    JOIN listings l ON l.id = d.listing_id`;
}

async function loadDealReviews(sql: Sql, dealIds: string[]): Promise<ReviewRow[]> {
  if (dealIds.length === 0) return [];
  return sql<ReviewRow[]>`${reviewSelect(sql)} WHERE r.deal_id = ANY(${dealIds}::uuid[]) AND r.hidden_at IS NULL`;
}

const listingImage = (row: ConversationRow): MediaDto | null => {
  if (row.mainThumb) return { url: mediaUrl(row.mainThumb), kind: "image" };
  if (row.itemIconPath && row.itemIconKind) return { url: mediaUrl(row.itemIconPath), kind: row.itemIconKind };
  return null;
};

/** Превращает строки переписок в ответ API (с отзывами по сделкам одним запросом). */
export async function toConversations(sql: Sql, rows: readonly ConversationRow[], viewerId: string): Promise<ConversationDto[]> {
  const reviews = await loadDealReviews(
    sql,
    rows.map((r) => r.dealId).filter((id): id is string => id !== null),
  );
  return rows.map((row) => {
    const role = row.buyerId === viewerId ? "buyer" : "seller";
    let deal: DealDto | null = null;
    if (row.dealId && row.dealStatus && row.dealProposedAt) {
      const forDeal = reviews.filter((r) => r.dealId === row.dealId);
      const mine = forDeal.find((r) => r.authorId === viewerId) ?? null;
      const theirs = forDeal.find((r) => r.authorId !== viewerId) ?? null;
      deal = {
        id: row.dealId,
        status: row.dealStatus,
        proposedByMe: row.dealProposedBy === viewerId,
        proposedAt: row.dealProposedAt.toISOString(),
        confirmedAt: row.dealConfirmedAt?.toISOString() ?? null,
        myReview: mine ? toReview(mine) : null,
        theirReview: theirs ? toReview(theirs) : null,
        canReview: row.dealStatus === "confirmed" && !mine,
      };
    }
    return {
      id: row.id,
      role,
      listing: {
        id: row.listingId,
        title: row.listingTitle,
        price: row.listingPrice === null ? null : Number(row.listingPrice),
        operation: row.listingOperation,
        status: row.listingStatus,
        image: listingImage(row),
        server: { number: row.serverNumber, name: row.serverName, color: row.serverColor },
      },
      counterpart:
        role === "buyer"
          ? { login: row.sellerLogin, nickname: row.sellerNickname, lastSeenAt: row.sellerLastSeen?.toISOString() ?? null }
          : { login: row.buyerLogin, nickname: row.buyerNickname, lastSeenAt: row.buyerLastSeen?.toISOString() ?? null },
      blocked: row.blocked,
      lastMessage:
        row.lastKind && row.lastCreatedAt
          ? {
              kind: row.lastKind,
              body: row.lastHidden ? "" : row.lastBody ?? "",
              mine: row.lastSenderId === null ? null : row.lastSenderId === viewerId,
              createdAt: row.lastCreatedAt.toISOString(),
            }
          : null,
      unread: row.unread,
      deal,
      lastMessageAt: row.lastMessageAt.toISOString(),
    };
  });
}

/** Переписка, если пользователь в ней участвует. Иначе — «не найдено», чтобы не раскрывать чужие диалоги. */
export async function participantConversation(sql: Sql, id: string, viewerId: string): Promise<ConversationRow> {
  const [row] = await sql<ConversationRow[]>`
    ${conversationSelect(sql, viewerId)}
    WHERE c.id = ${id} AND (c.buyer_id = ${viewerId} OR c.seller_id = ${viewerId})`;
  if (!row) throw errors.notFound("Переписка не найдена");
  return row;
}

export interface MessageRow {
  id: string;
  senderId: string | null;
  kind: MessageKind;
  body: string;
  imagePath: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  flagged: boolean;
  hiddenAt: Date | null;
  createdAt: Date;
}

export const MESSAGE_COLUMNS = "id, sender_id, kind, body, image_path, image_width, image_height, flagged, hidden_at, created_at";

export function toMessage(row: MessageRow, viewerId: string | null): MessageDto {
  const hidden = row.hiddenAt !== null;
  return {
    id: row.id,
    kind: row.kind,
    body: hidden ? "" : row.body,
    image:
      !hidden && row.imagePath
        ? { url: mediaUrl(row.imagePath), width: row.imageWidth ?? 0, height: row.imageHeight ?? 0 }
        : null,
    mine: row.senderId === null ? null : row.senderId === viewerId,
    hidden,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Есть ли блокировка между двумя игроками в любую сторону. */
export async function blockedBetween(sql: Sql, a: string, b: string): Promise<boolean> {
  const [row] = await sql`
    SELECT 1 FROM user_blocks WHERE (user_id = ${a} AND blocked_id = ${b}) OR (user_id = ${b} AND blocked_id = ${a}) LIMIT 1`;
  return Boolean(row);
}

export const chatBlocked = () =>
  new AppError(403, "chat_blocked", "Переписка с этим игроком недоступна: один из вас добавил другого в чёрный список");
