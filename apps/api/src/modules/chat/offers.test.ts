import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type {
  AuthResponseDto,
  ConversationDto,
  GameProfileDto,
  ListingTypeDto,
  MessagesPageDto,
  MyListingDto,
  PriceHistoryDto,
  UpdatesDto,
} from "@twm/shared";
import { bearer, createStaff, registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../../test-helpers.js";

describe("предложение цены в переписке", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  let admin: AuthResponseDto;
  let itemTypeId: number;
  let vehicleTypeId: number;
  let categoryId: number;
  let seller: AuthResponseDto & { profile: GameProfileDto };
  let buyer: AuthResponseDto & { profile: GameProfileDto };

  type Method = "GET" | "POST";
  const call = (method: Method, url: string, token?: string, payload?: unknown) =>
    env.app.inject({ method, url, headers: token ? bearer(token) : {}, ...(payload === undefined ? {} : { payload: payload as object }) });

  const player = async (nickname: string) => {
    const user = await registerUser(env);
    await env.database.sql`UPDATE users SET email_verified_at = now() WHERE id = ${user.user.id}`;
    const profile = (await call("POST", "/v1/me/game-profiles", user.accessToken, { nickname, serverNumber: 5 })).json() as GameProfileDto;
    return { ...user, profile };
  };

  let counter = 0;
  const publish = async (overrides: Record<string, unknown> = {}) => {
    counter += 1;
    const item = (await call("POST", "/v1/admin/catalog-items", admin.accessToken, { categoryId, name: `Товар ${counter}` })).json() as { id: number };
    const created = await call("POST", "/v1/listings", seller.accessToken, {
      gameProfileId: seller.profile.id,
      listingTypeId: itemTypeId,
      operation: "sell",
      catalogItemId: item.id,
      price: 1_000_000,
      ...overrides,
    });
    assert.equal(created.statusCode, 201, created.body);
    const published = await call("POST", `/v1/listings/${(created.json() as MyListingDto).id}/publish`, seller.accessToken);
    assert.equal(published.statusCode, 200, published.body);
    return { listing: published.json() as MyListingDto, itemId: item.id };
  };

  const open = async (listingId: string) => {
    const response = await call("POST", `/v1/listings/${listingId}/conversations`, buyer.accessToken);
    assert.equal(response.statusCode, 200, response.body);
    return response.json() as ConversationDto;
  };

  const offer = (token: string, conversationId: string, price: unknown) =>
    call("POST", `/v1/conversations/${conversationId}/offers`, token, { price });
  const answer = (token: string, conversationId: string, offerId: string, action: "accept" | "decline" | "withdraw") =>
    call("POST", `/v1/conversations/${conversationId}/offers/${offerId}/${action}`, token);
  const messages = async (token: string, conversationId: string) =>
    ((await call("GET", `/v1/conversations/${conversationId}/messages`, token)).json() as MessagesPageDto).items;

  before(async () => {
    env = await setupTestEnv();
    admin = await createStaff(env, "admin");
    const types = ((await call("GET", "/v1/admin/listing-types", admin.accessToken)).json() as { items: ListingTypeDto[] }).items;
    itemTypeId = types.find((t) => t.code === "item")!.id;
    vehicleTypeId = types.find((t) => t.code === "vehicle")!.id;
    categoryId = ((await call("POST", "/v1/admin/categories", admin.accessToken, { sectionCode: "items", name: "Торг" })).json() as { id: number }).id;
    seller = await player("Offer_Seller");
    buyer = await player("Offer_Buyer");
  });
  after(async () => {
    await env.close();
  });

  test("предложить, встречная цена, принять, сделка по согласованной цене", async () => {
    const { listing, itemId } = await publish();
    const conversation = await open(listing.id);
    assert.equal(conversation.canOffer, true);
    assert.equal(conversation.offer, null);
    assert.equal(conversation.agreedPrice, null);

    assert.equal((await offer(buyer.accessToken, conversation.id, 0)).statusCode, 400, "цена больше нуля");
    assert.equal((await offer(buyer.accessToken, conversation.id, 12.5)).statusCode, 400, "целое число");

    const before = (await call("GET", "/v1/me/updates", seller.accessToken)).json() as UpdatesDto;
    const made = await offer(buyer.accessToken, conversation.id, 800_000);
    assert.equal(made.statusCode, 201, made.body);
    const mine = made.json() as ConversationDto;
    assert.equal(mine.offer?.price, 800_000);
    assert.equal(mine.offer?.mine, true);

    // Продавец видит предложение и уведомление.
    const theirs = (await call("GET", `/v1/conversations/${conversation.id}`, seller.accessToken)).json() as ConversationDto;
    assert.equal(theirs.offer?.mine, false);
    assert.equal(theirs.offer?.id, mine.offer?.id);
    const updates = (await call("GET", `/v1/me/updates?after=${before.cursor}`, seller.accessToken)).json() as UpdatesDto;
    assert.equal(updates.notifications[0]?.kind, "price_offer");

    // Второе своё предложение до ответа — нельзя; принять своё — нельзя.
    assert.equal((await offer(buyer.accessToken, conversation.id, 850_000)).statusCode, 409);
    assert.equal((await answer(buyer.accessToken, conversation.id, mine.offer!.id, "accept")).statusCode, 409);

    // Встречное предложение продавца заменяет предложение покупателя.
    const counterResponse = await offer(seller.accessToken, conversation.id, 900_000);
    assert.equal(counterResponse.statusCode, 201, counterResponse.body);
    const counter = counterResponse.json() as ConversationDto;
    assert.equal(counter.offer?.price, 900_000);
    assert.equal(counter.offer?.mine, true);
    assert.equal((await answer(seller.accessToken, conversation.id, mine.offer!.id, "accept")).statusCode, 409, "старое предложение неактуально");
    const [old] = await env.database.sql<{ status: string }[]>`SELECT status FROM price_offers WHERE id = ${mine.offer!.id}`;
    assert.equal(old?.status, "countered");

    const accepted = await answer(buyer.accessToken, conversation.id, counter.offer!.id, "accept");
    assert.equal(accepted.statusCode, 200, accepted.body);
    const agreed = accepted.json() as ConversationDto;
    assert.equal(agreed.offer, null);
    assert.equal(agreed.agreedPrice, 900_000);
    assert.equal((await answer(buyer.accessToken, conversation.id, counter.offer!.id, "accept")).statusCode, 409, "дважды не принять");

    const log = await messages(buyer.accessToken, conversation.id);
    assert.deepEqual(
      log.map((m) => [m.kind, m.mine, m.offerPrice]),
      [
        ["price_offer", true, 800_000],
        ["price_offer", false, 900_000],
        ["offer_accepted", null, null],
      ],
    );
    assert.match(log[1]!.body, /^Встречное предложение/);

    // Сделка записывается по согласованной цене, торг после отметки закрыт.
    const proposed = (await call("POST", `/v1/conversations/${conversation.id}/deal`, seller.accessToken)).json() as ConversationDto;
    assert.equal(proposed.deal?.price, 900_000);
    assert.equal(proposed.canOffer, false);
    assert.equal((await offer(buyer.accessToken, conversation.id, 700_000)).statusCode, 409);
    assert.equal((await call("POST", `/v1/conversations/${conversation.id}/deal/confirm`, buyer.accessToken)).statusCode, 200);

    const history = (await call("GET", `/v1/catalog/items/${itemId}/prices?days=30`)).json() as PriceHistoryDto;
    assert.equal(history.deals.count, 1);
    assert.equal(history.deals.recent[0]?.price, 900_000, "в истории — цена сделки, а не объявления");
  });

  test("отклонить, отозвать; без торга сделка по цене объявления", async () => {
    const { listing } = await publish({ price: 2_000_000 });
    const conversation = await open(listing.id);

    const first = (await offer(buyer.accessToken, conversation.id, 1_500_000)).json() as ConversationDto;
    assert.equal((await answer(buyer.accessToken, conversation.id, first.offer!.id, "decline")).statusCode, 409, "своё — только отозвать");
    const declined = await answer(seller.accessToken, conversation.id, first.offer!.id, "decline");
    assert.equal(declined.statusCode, 200, declined.body);
    assert.equal((declined.json() as ConversationDto).offer, null);
    assert.equal((declined.json() as ConversationDto).agreedPrice, null);

    const second = (await offer(buyer.accessToken, conversation.id, 1_800_000)).json() as ConversationDto;
    assert.equal((await answer(seller.accessToken, conversation.id, second.offer!.id, "withdraw")).statusCode, 409, "чужое не отозвать");
    const withdrawn = await answer(buyer.accessToken, conversation.id, second.offer!.id, "withdraw");
    assert.equal(withdrawn.statusCode, 200, withdrawn.body);
    assert.equal((withdrawn.json() as ConversationDto).offer, null);

    const kinds = (await messages(seller.accessToken, conversation.id)).map((m) => m.kind);
    assert.deepEqual(kinds, ["price_offer", "offer_declined", "price_offer", "offer_withdrawn"]);

    // В переписке писали обе стороны — сделку можно отметить.
    await call("POST", `/v1/conversations/${conversation.id}/messages`, seller.accessToken, { body: "Цена окончательная" });
    const deal = (await call("POST", `/v1/conversations/${conversation.id}/deal`, buyer.accessToken)).json() as ConversationDto;
    assert.equal(deal.deal?.price, 2_000_000);
  });

  test("обмен, снятое объявление и чёрный список — без торга", async () => {
    const carCategory = (await call("POST", "/v1/admin/categories", admin.accessToken, { sectionCode: "cars", name: "Легковые" })).json() as { id: number };
    const car = (await call("POST", "/v1/admin/catalog-items", admin.accessToken, { categoryId: carCategory.id, name: "Машина" })).json() as { id: number };
    const exchange = await call("POST", "/v1/listings", seller.accessToken, {
      gameProfileId: seller.profile.id,
      listingTypeId: vehicleTypeId,
      operation: "exchange",
      catalogItemId: car.id,
      wantDescription: "Другая машина",
    });
    assert.equal(exchange.statusCode, 201, exchange.body);
    const published = await call("POST", `/v1/listings/${(exchange.json() as MyListingDto).id}/publish`, seller.accessToken);
    assert.equal(published.statusCode, 200, published.body);
    const exchangeChat = await open((published.json() as MyListingDto).id);
    assert.equal(exchangeChat.canOffer, false);
    assert.equal((await offer(buyer.accessToken, exchangeChat.id, 100)).statusCode, 409);

    const { listing } = await publish();
    const chat = await open(listing.id);
    await env.database.sql`UPDATE listings SET status = 'withdrawn' WHERE id = ${listing.id}`;
    assert.equal((await offer(buyer.accessToken, chat.id, 100)).statusCode, 409, "объявление снято");
    await env.database.sql`UPDATE listings SET status = 'active' WHERE id = ${listing.id}`;

    const pending = (await offer(buyer.accessToken, chat.id, 500_000)).json() as ConversationDto;
    assert.equal((await call("POST", `/v1/users/${encodeURIComponent(buyer.user.login)}/block`, seller.accessToken)).statusCode, 204);
    assert.equal((await offer(seller.accessToken, chat.id, 600_000)).statusCode, 403);
    assert.equal((await answer(seller.accessToken, chat.id, pending.offer!.id, "accept")).statusCode, 403);
    // Отклонить можно и при блокировке: это только закрывает торг.
    assert.equal((await answer(seller.accessToken, chat.id, pending.offer!.id, "decline")).statusCode, 200);
  });
});
