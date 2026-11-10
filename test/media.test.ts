import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadAndSaveImage, downloadAndSaveFile } from "../src/server/media.ts";
import { createFakeContext } from "./helper.ts";

test("Media", async () => {
  let ctx: any;

  test.beforeEach(() => {
    ctx = createFakeContext();
    ctx.logger = {
      error: (msg: string) => console.log("ERROR:", msg),
    };
  });

  function createMinimalPng(): Uint8Array {
    const bytes = [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0xfe, 0x00, 0x1e, 0x1f, 0xb0, 0x02,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82,
    ];
    return new Uint8Array(bytes);
  }

  function mockHttpGet(
    data: Buffer,
    statusCode = 200,
    contentLength?: number,
  ): () => Promise<{ statusCode: number; headers: Record<string, string | string[]>; body: Buffer }> {
    return async () => ({
      statusCode,
      headers: (contentLength !== undefined ? { "content-length": String(contentLength) } : {}) as Record<string, string | string[]>,
      body: data,
    });
  }

  test("downloadAndSaveImage saves image data", async () => {
    const pngData = createMinimalPng();
    const httpGet = mockHttpGet(Buffer.from(pngData), 200, pngData.length);

    const result = await downloadAndSaveImage("https://example.com/file.png", ctx, undefined, httpGet);
    assert.ok(result instanceof Uint8Array);
    assert.strictEqual(result.length, pngData.length);
    assert.strictEqual(ctx.attachments.savedImages.length, 1);
    assert.strictEqual(ctx.attachments.savedImages[0].mediaType, "image/png");
  });

  test("downloadAndSaveFile saves file data", async () => {
    const fileData = new TextEncoder().encode("Hello, this is a test file!");
    const httpGet = mockHttpGet(Buffer.from(fileData), 200, fileData.length);

    const result = await downloadAndSaveFile("https://example.com/file.txt", ctx, undefined, httpGet);
    assert.ok(result instanceof Uint8Array);
    assert.strictEqual(result.length, fileData.length);
    assert.strictEqual(ctx.attachments.savedFiles.length, 1);
  });

  test("rejects files larger than maxSize", async () => {
    const largeData = new Uint8Array(20 * 1024 * 1024);
    const httpGet = mockHttpException(Buffer.from(largeData), 200);

    await assert.rejects(
      () => downloadAndSaveFile("https://example.com/large.bin", ctx, 10 * 1024 * 1024, httpGet),
      /too large|exceeded/i,
    );
  });

  test("logs download errors", async () => {
    const logs: string[] = [];
    ctx.logger = {
      error: (msg: string) => logs.push(msg),
    };

    const httpGet = mockHttpException(Buffer.from(""), 404);

    await assert.rejects(
      () => downloadAndSaveFile("https://example.com/missing.jpg", ctx, undefined, httpGet),
      /HTTP 404/,
    );
    assert.ok(logs.some((l) => l.includes("Failed to download")));
  });
});

function mockHttpException(data: Buffer, statusCode: number): () => Promise<{ statusCode: number; headers: Record<string, string | string[]>; body: Buffer }> {
  return async () => ({
    statusCode,
    headers: {} as Record<string, string | string[]>,
    body: data,
  });
}
