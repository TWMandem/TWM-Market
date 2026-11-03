import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { signV4 } from "../mail/sigv4.js";

/**
 * Минимальный клиент Object Storage (S3-совместимого, например Yandex Cloud):
 * загрузить файл, список файлов, удалить файл. Для копий базы вне сервера.
 */
export interface StorageOptions {
  endpoint: string;
  bucket: string;
  region: string;
  keyId: string;
  secret: string;
  fetch?: typeof fetch;
}

export interface StoredObject {
  key: string;
  lastModified: Date;
  size: number;
}

function objectUrl(o: StorageOptions, key: string, query = ""): URL {
  const base = o.endpoint.replace(/\/+$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  return new URL(`${base}/${encodeURIComponent(o.bucket)}/${path}${query}`);
}

async function send(o: StorageOptions, method: string, url: URL, headers: Record<string, string> = {}, body?: BodyInit, payloadHash = "UNSIGNED-PAYLOAD") {
  const signed = signV4({
    method,
    url,
    headers: { ...headers, "x-amz-content-sha256": payloadHash },
    body: "",
    payloadHash,
    accessKeyId: o.keyId,
    secretAccessKey: o.secret,
    region: o.region,
    service: "s3",
  });
  const init: RequestInit & { duplex?: "half" } = { method, headers: signed };
  if (body !== undefined) {
    init.body = body;
    init.duplex = "half";
  }
  const response = await (o.fetch ?? fetch)(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? "";
    throw new Error(`Object Storage: ${method} ${url.pathname} — ${response.status} ${code}`.trim());
  }
  return response;
}

/** Файлы до 512 МБ читаются целиком (размер известен заранее), больше — потоком. */
const STREAM_FROM_BYTES = 512 * 1024 * 1024;

export async function uploadFile(o: StorageOptions, key: string, path: string): Promise<void> {
  const { size } = await stat(path);
  const body: BodyInit =
    size < STREAM_FROM_BYTES ? new Uint8Array(await readFile(path)) : (Readable.toWeb(createReadStream(path)) as unknown as BodyInit);
  const headers: Record<string, string> = { "content-type": "application/octet-stream" };
  if (size >= STREAM_FROM_BYTES) headers["content-length"] = String(size);
  await send(o, "PUT", objectUrl(o, key), headers, body);
}

export async function listObjects(o: StorageOptions, prefix: string): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  let token: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const params = new URLSearchParams({ "list-type": "2", prefix });
    if (token) params.set("continuation-token", token);
    const url = objectUrl(o, "", `?${params.toString()}`);
    const xml = await (await send(o, "GET", url, {}, undefined, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")).text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = m[1] ?? "";
      const key = /<Key>([^<]+)<\/Key>/.exec(block)?.[1];
      const modified = /<LastModified>([^<]+)<\/LastModified>/.exec(block)?.[1];
      const size = Number(/<Size>(\d+)<\/Size>/.exec(block)?.[1] ?? 0);
      if (key && modified) out.push({ key: decodeXml(key), lastModified: new Date(modified), size });
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
    token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null;
    if (!token) break;
  }
  return out;
}

export async function deleteObject(o: StorageOptions, key: string): Promise<void> {
  await send(o, "DELETE", objectUrl(o, key), {}, undefined, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
}

const decodeXml = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

export const fileName = (path: string) => basename(path);
