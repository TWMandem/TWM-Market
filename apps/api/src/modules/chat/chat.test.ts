import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type {
  AuthResponseDto,
  ConversationDto,
  FlaggedMessageDto,
  GameProfileDto,
  ListingDetailDto,
  ListingTypeDto,
  MessageDto,
  MessagesPageDto,
  ModerationListingDto,
  MyListingDto,
  NotificationDto,
  PublicUserDto,
  ReportDto,
  StopWordDto,
  UpdatesDto,
} from "@twm/shared";
import { bearer, createStaff, registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../../test-helpers.js";

function multipart(name: string, filename: string, data: Buffer, contentType: string) {
  const boundary = "----twm-chat-boundary";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe("переписка, сделки, отзывы, жалобы, модерация", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  let admin: AuthResponseDto;
  let seller: AuthResponseDto;
  let buyer: AuthResponseDto;
  let sellerProfile: GameProfileDto;
  let itemTypeId: number;
  let categoryId: number;
  let listingId: string;

  type Method = "GET" | "POST" | "PUT" | "DELETE";
  const call = (method: Method, url: string, token?: string, payload?: unknown) =>
    env.app.inject({ method, url, headers: token ? bearer(token) : {}, ...(payload === undefined ? {} : { payload: payload as object }) });

  const verifiedUser = async () => {
    const user = await registerUser(env);
    await env.database.sql`UPDATE users SET email_verified_at = now() WHERE id = ${user.user.id}`;
    return user;
  };

  let itemCounter = 0;
  /** Публикует объявление продавца о новом предмете (дубли не публикуются). */
  const publishListing = async (overrides: Record<string, unknown> = {}) => {
    itemCounter += 1;
    const item = (await call("POST", "/v1/admin/catalog-items", admin.accessToken, { categoryId, name: `Предмет ${itemCounter}` })).json() as { id: number };
    const created = await call("POST", "/v1/listings", seller.accessToken, {
      gameProfileId: sellerProfile.id,
      listingTypeId: itemTypeId,
      operation: "sell",
      catalogItemId: item.id,
      price: 1_000_000,
      ...overrides,
    });
    assert.equal(created.statusCode, 201, created.body);
    const published = await call("POST", `/v1/listings/${(created.json() as MyListingDto).id}/publish`, seller.accessToken);
    assert.equal(published.statusCode, 200, published.body);
    return published.json() as MyListingDto;
  };

  const openConversation = async (token: string, id = listingId) => {
    const response = await call("POST", `/v1/listings/${id}/conversations`, token);
    assert.equal(response.statusCode, 200, response.body);
    return response.json() as ConversationDto;
  };

  const send = async (token: string, conversationId: string, body: string) => {
    const response = await call("POST", `/v1/conversations/${conversationId}/messages`, token, { body });
    assert.equal(response.statusCode, 201, response.body);
    return response.json() as MessageDto;
  };

  before(async () => {
    env = await setupTestEnv();
    admin = await createStaff(env, "admin");
    const types = ((await call("GET", "/v1/admin/listing-types", admin.accessToken)).json() as { items: ListingTypeDto[] }).items;
    itemTypeId = types.find((t) => t.code === "item")!.id;
    categoryId = ((await call("POST", "/v1/admin/categories", admin.accessToken, { sectionCode: "items", name: "Разное" })).json() as { id: number }).id;

    seller = await verifiedUser();
    buyer = await verifiedUser();
    sellerProfile = (await call("POST", "/v1/me/game-profiles", seller.accessToken, { nickname: "Seller_Main", serverNumber: 3 })).json() as GameProfileDto;
    await call("POST", "/v1/me/game-profiles", buyer.accessToken, { nickname: "Buyer_Main", serverNumber: 3 });
    listingId = (await publishListing()).id;
  });
  after(async () => {
    await env.close();
  });

  test("переписка по объявлению: начать, писать, непрочитанное, уведомления", async () => {
    assert.equal((await call("POST", `/v1/listings/${listingId}/conversations`, seller.accessToken)).statusCode, 409, "своё объявление");
    const unverified = await registerUser(env);
    assert.equal((await call("POST", `/v1/listings/${listingId}/conversations`, unverified.accessToken)).statusCode, 403);

    const conversation = await openConversation(buyer.accessToken);
    assert.equal(conversation.role, "buyer");
    assert.equal(conversation.counterpart.nickname, "Seller_Main");
    assert.equal((await openConversation(buyer.accessToken)).id, conversation.id, "повторно — та же переписка");

    // Пустая переписка продавцу не видна.
    let sellerList = (await call("GET", "/v1/me/conversations", seller.accessToken)).json() as { items: ConversationDto[] };
    assert.equal(sellerList.items.length, 0);

    const first = (await call("GET", "/v1/me/updates", seller.accessToken)).json() as UpdatesDto;
    await send(buyer.accessToken, conversation.id, "Здравствуйте! Ещё продаёте?");
    sellerList = (await call("GET", "/v1/me/conversations", seller.accessToken)).json() as { items: ConversationDto[] };
    assert.equal(sellerList.items[0]?.unread, 1);
    assert.equal(sellerList.items[0]?.counterpart.nickname, "Buyer_Main");

    const updates = (await call("GET", `/v1/me/updates?after=${first.cursor}`, seller.accessToken)).json() as UpdatesDto;
    assert.equal(updates.unreadMessages, 1);
    assert.equal(updates.notifications[0]?.kind, "message");
    assert.equal(updates.notifications[0]?.link, `/chats/${conversation.id}`);

    const png = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#204060" } }).png().toBuffer();
    const form = multipart("file", "shot.png", png, "image/png");
    const image = await env.app.inject({
      method: "POST",
      url: `/v1/conversations/${conversation.id}/images`,
      headers: { ...bearer(buyer.accessToken), ...form.headers },
      payload: form.payload,
    });
    assert.equal(image.statusCode, 201, image.body);
    assert.equal((image.json() as MessageDto).kind, "image");

    const page = (await call("GET", `/v1/conversations/${conversation.id}/messages`, seller.accessToken)).json() as MessagesPageDto;
    assert.deepEqual(page.items.map((m) => [m.kind, m.mine]), [["text", false], ["image", false]]);
    const afterRead = (await call("GET", "/v1/me/updates", seller.accessToken)).json() as UpdatesDto;
    assert.equal(afterRead.unreadMessages, 0, "открыть переписку — прочитать");

    const stranger = await verifiedUser();
    assert.equal((await call("GET", `/v1/conversations/${conversation.id}`, stranger.accessToken)).statusCode, 404);
    assert.equal((await call("POST", `/v1/conversations/${conversation.id}/messages`, stranger.accessToken, { body: "Привет" })).statusCode, 404);
  });

  test("сделка подтверждается второй стороной, потом отзывы", async () => {
    const id = (await publishListing()).id;
    const conversation = await openConversation(buyer.accessToken, id);
    await send(buyer.accessToken, conversation.id, "Беру");
    const early = await call("POST", `/v1/conversations/${conversation.id}/deal`, buyer.accessToken);
    assert.equal(early.statusCode, 409, "продавец ещё не отвечал");
    await send(seller.accessToken, conversation.id, "Договорились, встречаемся в 18:00");

    const proposed = (await call("POST", `/v1/conversations/${conversation.id}/deal`, buyer.accessToken)).json() as ConversationDto;
    assert.equal(proposed.deal?.status, "proposed");
    assert.equal(proposed.deal?.proposedByMe, true);
    assert.equal((await call("POST", `/v1/conversations/${conversation.id}/deal/confirm`, buyer.accessToken)).statusCode, 409);
    assert.equal((await call("POST", `/v1/conversations/${conversation.id}/review`, buyer.accessToken, { positive: true })).statusCode, 409, "до подтверждения");

    const confirmed = (await call("POST", `/v1/conversations/${conversation.id}/deal/confirm`, seller.accessToken)).json() as ConversationDto;
    assert.equal(confirmed.deal?.status, "confirmed");
    assert.equal(confirmed.deal?.canReview, true);

    const review = await call("POST", `/v1/conversations/${conversation.id}/review`, buyer.accessToken, { positive: true, comment: "Всё честно" });
    assert.equal(review.statusCode, 201, review.body);
    assert.equal((review.json() as ConversationDto).deal?.myReview?.comment, "Всё честно");
    assert.equal((await call("POST", `/v1/conversations/${conversation.id}/review`, buyer.accessToken, { positive: false })).statusCode, 409);

    const profile = (await call("GET", `/v1/users/${seller.user.login}`)).json() as PublicUserDto;
    assert.deepEqual(profile.reviews, { positive: 1, negative: 0 });
    assert.equal(profile.deals, 1);
    assert.equal(profile.recentReviews[0]?.author.login, buyer.user.login);
    const detail = (await call("GET", `/v1/listings/${id}`)).json() as ListingDetailDto;
    assert.deepEqual(detail.seller.reviews, { positive: 1, negative: 0 });

    const messages = (await call("GET", `/v1/conversations/${conversation.id}/messages`, buyer.accessToken)).json() as MessagesPageDto;
    assert.ok(messages.items.some((m) => m.kind === "deal_confirmed" && m.mine === null), "служебные сообщения в переписке");
  });

  test("стоп-слова: сообщение в очередь модерации, объявление на проверку", async () => {
    const conversation = await openConversation(buyer.accessToken);
    const flagged = await send(buyer.accessToken, conversation.id, "Могу скинуть НА КАРТУ, так быстрее");
    const queue = (await call("GET", "/v1/admin/messages/flagged", admin.accessToken)).json() as { items: FlaggedMessageDto[] };
    assert.ok(queue.items.some((m) => m.id === flagged.id && m.flagReason?.includes("на карту")));

    assert.equal((await call("POST", `/v1/admin/messages/${flagged.id}/hide`, admin.accessToken)).statusCode, 200);
    const page = (await call("GET", `/v1/conversations/${conversation.id}/messages`, seller.accessToken)).json() as MessagesPageDto;
    const hidden = page.items.find((m) => m.id === flagged.id);
    assert.equal(hidden?.hidden, true);
    assert.equal(hidden?.body, "");

    const suspicious = await publishListing({ description: "Продам, оплата переводом на карту" });
    assert.equal(suspicious.status, "moderation");
    assert.match(suspicious.moderationReason ?? "", /Стоп-слово/);
    assert.equal((await call("GET", `/v1/listings/${suspicious.id}`)).statusCode, 404, "до проверки не видно");

    const listings = (await call("GET", "/v1/admin/moderation/listings", admin.accessToken)).json() as { items: ModerationListingDto[] };
    assert.ok(listings.items.some((l) => l.id === suspicious.id));
    assert.equal((await call("POST", `/v1/admin/moderation/listings/${suspicious.id}/approve`, admin.accessToken)).statusCode, 200);
    const approved = (await call("GET", `/v1/listings/${suspicious.id}`)).json() as ListingDetailDto;
    assert.equal(approved.status, "active");
    const notifications = (await call("GET", "/v1/me/notifications", seller.accessToken)).json() as { items: NotificationDto[] };
    assert.ok(notifications.items.some((n) => n.kind === "listing_approved"));
  });

  test("жалобы: три разных игрока скрывают объявление до проверки", async () => {
    const id = (await publishListing()).id;
    const reporters = [buyer, await verifiedUser(), await verifiedUser()];
    for (const [index, reporter] of reporters.entries()) {
      const report = await call("POST", "/v1/reports", reporter.accessToken, { targetType: "listing", targetId: id, reason: "real_money" });
      assert.equal(report.statusCode, 201, report.body);
      const status = ((await call("GET", `/v1/me/listings/${id}`, seller.accessToken)).json() as MyListingDto).status;
      assert.equal(status, index < 2 ? "active" : "moderation");
    }
    const again = await call("POST", "/v1/reports", buyer.accessToken, { targetType: "listing", targetId: id, reason: "scam" });
    assert.equal(again.statusCode, 409, "одна открытая жалоба от игрока");
    assert.equal((await call("POST", "/v1/reports", seller.accessToken, { targetType: "listing", targetId: id, reason: "scam" })).statusCode, 409);

    const reports = (await call("GET", "/v1/admin/reports", admin.accessToken)).json() as { items: ReportDto[] };
    const forListing = reports.items.filter((r) => r.targetId === id);
    assert.equal(forListing.length, 3);
    assert.equal(forListing[0]?.openCount, 3);

    const reject = await call("POST", `/v1/admin/moderation/listings/${id}/reject`, admin.accessToken, { reason: "Торговля за реальные деньги" });
    assert.equal(reject.statusCode, 200, reject.body);
    const rejected = (await call("GET", `/v1/me/listings/${id}`, seller.accessToken)).json() as MyListingDto;
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.rejectionReason, "Торговля за реальные деньги");
    const open = (await call("GET", "/v1/admin/reports", admin.accessToken)).json() as { items: ReportDto[] };
    assert.ok(!open.items.some((r) => r.targetId === id), "жалобы закрыты вместе с решением");

    // Жалоба на игрока: по логину, решение уведомляет автора.
    const userReport = await call("POST", "/v1/reports", buyer.accessToken, {
      targetType: "user",
      targetId: seller.user.login,
      reason: "insult",
      comment: "Грубит в переписке",
    });
    assert.equal(userReport.statusCode, 201, userReport.body);
    const reportId = (userReport.json() as { id: string }).id;
    assert.equal((await call("POST", `/v1/admin/reports/${reportId}/resolve`, admin.accessToken, { status: "dismissed" })).statusCode, 200);
    const buyerNotes = (await call("GET", "/v1/me/notifications", buyer.accessToken)).json() as { items: NotificationDto[] };
    assert.ok(buyerNotes.items.some((n) => n.kind === "report_resolved"));
  });

  test("стоп-слова в админке: добавить, проверить выражение, удалить", async () => {
    const moderator = await createStaff(env, "moderator");
    assert.equal((await call("POST", "/v1/admin/stop-words", moderator.accessToken, { phrase: "голда за реал" })).statusCode, 403, "только администратор");
    assert.equal((await call("POST", "/v1/admin/stop-words", admin.accessToken, { phrase: "([a-z", isRegex: true })).statusCode, 400);

    const created = await call("POST", "/v1/admin/stop-words", admin.accessToken, { phrase: "продам аккаунт", note: "Продажа аккаунтов" });
    assert.equal(created.statusCode, 201, created.body);
    const word = created.json() as StopWordDto;
    const listing = await publishListing({ description: "Продам аккаунт целиком" });
    assert.equal(listing.status, "moderation");

    assert.equal((await call("DELETE", `/v1/admin/stop-words/${word.id}`, admin.accessToken)).statusCode, 204);
    const list = (await call("GET", "/v1/admin/stop-words", moderator.accessToken)).json() as { items: StopWordDto[] };
    assert.ok(!list.items.some((w) => w.id === word.id));
  });
});
