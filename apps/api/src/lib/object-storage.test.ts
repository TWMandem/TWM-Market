import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteObject, listObjects, uploadFile, type StorageOptions } from "./object-storage.js";

function fakeStorage() {
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body: string }> = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body instanceof Uint8Array ? Buffer.from(init.body).toString() : "";
    calls.push({ method: init?.method ?? "GET", url: String(input), headers, body });
    if ((init?.method ?? "GET") === "GET") {
      return new Response(
        `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>
          <Contents><Key>twm-backups/2026-10-01/db.dump.enc</Key><LastModified>2026-10-01T04:30:00.000Z</LastModified><Size>2048</Size></Contents>
          <Contents><Key>twm-backups/2026-11-04/db.dump.enc</Key><LastModified>2026-11-04T04:30:00.000Z</LastModified><Size>4096</Size></Contents>
        </ListBucketResult>`,
        { status: 200 },
      );
    }
    return new Response("", { status: 200 });
  }) as typeof fetch;
  const options: StorageOptions = { endpoint: "https://storage.yandexcloud.net", bucket: "twm-copies", region: "ru-central1", keyId: "KEY", secret: "SECRET", fetch: fetchFn };
  return { calls, options };
}

test("Object Storage: загрузка, список и удаление с подписью SigV4", async () => {
  const { calls, options } = fakeStorage();
  const dir = await mkdtemp(join(tmpdir(), "twm-s3-"));
  const file = join(dir, "db.dump.enc");
  await writeFile(file, "зашифрованная копия");
  try {
    await uploadFile(options, "twm-backups/2026-11-04/db.dump.enc", file);
    const put = calls[0]!;
    assert.equal(put.method, "PUT");
    assert.equal(put.url, "https://storage.yandexcloud.net/twm-copies/twm-backups/2026-11-04/db.dump.enc");
    assert.equal(put.headers["x-amz-content-sha256"], "UNSIGNED-PAYLOAD");
    assert.match(put.headers.authorization ?? "", /^AWS4-HMAC-SHA256 Credential=KEY\/\d{8}\/ru-central1\/s3\/aws4_request, SignedHeaders=.*x-amz-content-sha256.*, Signature=[0-9a-f]{64}$/);
    assert.equal(put.body, "зашифрованная копия");

    const list = await listObjects(options, "twm-backups/");
    assert.match(calls[1]!.url, /\/twm-copies\/\?list-type=2&prefix=twm-backups%2F$/);
    assert.deepEqual(list.map((o) => [o.key, o.size]), [
      ["twm-backups/2026-10-01/db.dump.enc", 2048],
      ["twm-backups/2026-11-04/db.dump.enc", 4096],
    ]);

    await deleteObject(options, "twm-backups/2026-10-01/db.dump.enc");
    assert.equal(calls[2]!.method, "DELETE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Object Storage: понятная ошибка с кодом из ответа", async () => {
  const options: StorageOptions = {
    endpoint: "https://storage.yandexcloud.net",
    bucket: "b",
    region: "ru-central1",
    keyId: "K",
    secret: "S",
    fetch: (async () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 })) as typeof fetch,
  };
  await assert.rejects(deleteObject(options, "x"), /403 AccessDenied/);
});
