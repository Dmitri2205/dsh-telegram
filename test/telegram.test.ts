import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { TelegramBot } from "../src/server/telegram.ts";
import type { HttpRequestFn } from "../src/server/telegram.ts";

interface MockRequestResult {
  fn: HttpRequestFn;
  callCount: number;
  lastOptions: any;
}

function createMockRequestFn(responses: Array<{ ok: boolean; result: any; error_code?: number; description?: string }>): MockRequestResult {
  let callCount = 0;
  const lastOptions: any = {};

  const mockFn: HttpRequestFn = (options, callback) => {
    callCount++;
    Object.assign(lastOptions, options);

    const mockRes = new Readable({ read() {} });
    Object.defineProperty(mockRes, 'statusCode', { value: 200, writable: true });
    Object.defineProperty(mockRes, 'headers', { value: { "content-type": "application/json" }, writable: true });

    if (responses.length > 0) {
      const resp = responses.shift()!;
      const data = JSON.stringify(resp);
      mockRes.push(data);
    } else {
      // Fallback: return a 500 error to prevent silent failures
      mockRes.push(JSON.stringify({ ok: false, result: null, error_code: 500, description: "Internal Server Error" }));
    }
    mockRes.push(null);

    if (callback) {
      callback(mockRes as any);
    }

    return {
      on: () => {},
      setTimeout: () => {},
      write: () => true,
      end: () => {},
      destroy: () => {},
    };
  };

  return { fn: mockFn, get callCount() { return callCount; }, lastOptions };
}

test("TelegramBot", async () => {
  const mockToken = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";

  test("constructs with a token", () => {
    const bot = new TelegramBot(mockToken);
    assert.ok(bot);
  });

  test("getMe sends correct request", async () => {
    const mock = createMockRequestFn([
      { ok: true, result: { id: 123, is_bot: true, username: "test_bot", first_name: "Test" } },
    ]);

    const bot = new TelegramBot(mockToken, { requestFn: mock.fn });
    const result = await bot.getMe();
    assert.strictEqual(result.id, 123);
    assert.strictEqual(result.is_bot, true);
    assert.strictEqual(result.username, "test_bot");
  });

  test("sendText sends correct request", async () => {
    const mock = createMockRequestFn([
      { ok: true, result: { message_id: 1 } },
    ]);

    const bot = new TelegramBot(mockToken, { requestFn: mock.fn });
    const result = await bot.sendText(12345, "Hello!");
    assert.ok(result);
  });

  test("sendPhoto sends correct request", async () => {
    const mock = createMockRequestFn([
      { ok: true, result: { message_id: 2 } },
    ]);

    const bot = new TelegramBot(mockToken, { requestFn: mock.fn });
    const result = await bot.sendPhoto(12345, "file_id_123", "Caption");
    assert.ok(result);
  });

  test("setWebhook sends correct request", async () => {
    const mock = createMockRequestFn([
      { ok: true, result: true },
    ]);

    const bot = new TelegramBot(mockToken, { requestFn: mock.fn });
    const result = await bot.setWebhook("https://example.com/telegram/webhook", "my-secret");
    assert.strictEqual(result, true);
  });

  test("deleteWebhook sends correct request", async () => {
    const mock = createMockRequestFn([
      { ok: true, result: true },
    ]);

    const bot = new TelegramBot(mockToken, { requestFn: mock.fn });
    const result = await bot.deleteWebhook();
    assert.strictEqual(result, true);
  });

  test("throws on Telegram API error", async () => {
    const mock = createMockRequestFn([
      { ok: false, result: null, error_code: 400, description: "Bad Request: chat not found" },
    ]);

    const bot = new TelegramBot(mockToken, { requestFn: mock.fn });

    await assert.rejects(
      () => bot.sendText(12345, "Hello!"),
      /Telegram API error \(400\): Bad Request: chat not found/,
    );
  });

  test("retries on 429 with delay", async () => {
    const mock = createMockRequestFn([
      { ok: false, result: null, error_code: 429, description: "Too Many Requests" },
      { ok: false, result: null, error_code: 429, description: "Too Many Requests" },
      { ok: true, result: { message_id: 1 } },
    ]);

    const bot = new TelegramBot(mockToken, { requestFn: mock.fn });

    const start = Date.now();
    await bot.sendText(12345, "Hello!");
    const elapsed = Date.now() - start;

    assert.strictEqual(mock.callCount, 3);
    assert.ok(elapsed >= 1000);
  });

  test("throws after max retries on 500", async () => {
    const mock = createMockRequestFn([
      { ok: false, result: null, error_code: 500, description: "Internal Server Error" },
      { ok: false, result: null, error_code: 500, description: "Internal Server Error" },
      { ok: false, result: null, error_code: 500, description: "Internal Server Error" },
    ]);

    const bot = new TelegramBot(mockToken, { requestFn: mock.fn });

    await assert.rejects(
      () => bot.sendText(12345, "Hello!"),
      /Telegram API server error/,
    );
  });
});
