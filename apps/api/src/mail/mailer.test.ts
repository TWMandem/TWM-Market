import { test } from "node:test";
import assert from "node:assert/strict";
import { PostboxMailer } from "./mailer.js";
import { AppError } from "../lib/errors.js";

const silent = { error: () => {} };

test("Postbox: подписанный запрос SendEmail с текстом письма", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = (async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const mailer = new PostboxMailer(
    { endpoint: "https://postbox.cloud.yandex.net", keyId: "KEYID", secret: "SECRET", from: "TWM Market <noreply@twm-market.ru>" },
    silent,
    fakeFetch,
  );
  await mailer.send({ to: "player@example.com", subject: "Код: 123456", text: "Ваш код 123456" });

  assert.equal(calls.length, 1);
  const { url, init } = calls[0]!;
  assert.equal(url, "https://postbox.cloud.yandex.net/v2/email/outbound-emails");
  const headers = init.headers as Record<string, string>;
  assert.match(headers.authorization ?? "", /^AWS4-HMAC-SHA256 Credential=KEYID\/\d{8}\/ru-central1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/);
  const body = JSON.parse(String(init.body));
  assert.equal(body.FromEmailAddress, "TWM Market <noreply@twm-market.ru>");
  assert.deepEqual(body.Destination.ToAddresses, ["player@example.com"]);
  assert.equal(body.Content.Simple.Body.Text.Data, "Ваш код 123456");
});

test("Postbox: отказ сервиса превращается в понятную ошибку", async () => {
  const fakeFetch = (async () => new Response("{\"message\":\"denied\"}", { status: 403 })) as typeof fetch;
  const mailer = new PostboxMailer({ endpoint: "https://postbox.cloud.yandex.net", keyId: "K", secret: "S", from: "a@b.ru" }, silent, fakeFetch);
  await assert.rejects(
    mailer.send({ to: "x@y.ru", subject: "s", text: "t" }),
    (error: unknown) => error instanceof AppError && error.code === "mail_unavailable",
  );
});
