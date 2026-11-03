import { createHash, createHmac } from "node:crypto";

/**
 * Подпись запроса AWS Signature Version 4. Ею подписываются запросы
 * к Yandex Cloud Postbox (API, совместимый с Amazon SES) и к Object Storage (S3).
 * Своя реализация — чтобы не тянуть весь AWS SDK ради одного запроса.
 */

const sha256 = (data: string) => createHash("sha256").update(data, "utf8").digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** Кодирование частей пути по правилам SigV4 (RFC 3986, «/» не кодируется). */
const encodePath = (path: string) =>
  path
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join("/");

export interface SignInput {
  method: string;
  url: URL;
  /** Заголовки, которые войдут в подпись (Host добавляется автоматически). */
  headers: Record<string, string>;
  body: string;
  /** Готовый хеш тела (например, «UNSIGNED-PAYLOAD» для больших файлов в Object Storage). */
  payloadHash?: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  date?: Date;
}

/** Возвращает заголовки запроса вместе с X-Amz-Date и Authorization. */
export function signV4(input: SignInput): Record<string, string> {
  const date = input.date ?? new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = { ...input.headers, host: input.url.host, "x-amz-date": amzDate };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonicalHeaders = names.map((name) => `${name}:${String(lower[name]).trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");

  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    input.method.toUpperCase(),
    encodePath(input.url.pathname || "/"),
    query,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash ?? sha256(input.body),
  ].join("\n");

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
