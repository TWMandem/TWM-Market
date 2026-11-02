import { test } from "node:test";
import assert from "node:assert/strict";
import { signV4 } from "./sigv4.js";

// Пример «get-vanilla» из официального набора тестов AWS Signature Version 4.
test("подпись SigV4 совпадает с эталоном AWS", () => {
  const headers = signV4({
    method: "GET",
    url: new URL("https://example.amazonaws.com/"),
    headers: {},
    body: "",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    service: "service",
    date: new Date("2015-08-30T12:36:00Z"),
  });
  assert.equal(
    headers.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
  );
  assert.equal(headers["x-amz-date"], "20150830T123600Z");
});
