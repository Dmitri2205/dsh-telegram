import { test } from "node:test";
import assert from "node:assert/strict";
import { createWebhookHandler, TelegramUpdate, WebhookConfig } from "../src/server/webhook.ts";
import { callWebhookHandler } from "./helper.ts";

test("Webhook handler", async () => {
  let receivedMessages: Array<{ chatId: number; message: { text?: string; photo?: string[]; document?: string } }> = [];

  const mockRouter = {
    routeMessage: async (chatId: number, message: { text?: string; photo?: string[]; document?: string }) => {
      receivedMessages.push({ chatId, message });
    },
  };

  const mockConfig: WebhookConfig = {
    webhookSecret: "my-secret-token",
    allowedChatIds: [],
  };

  test("accepts POST with valid JSON", async () => {
    const routeHandler = createWebhookHandler(mockConfig, mockRouter);
    receivedMessages = [];

    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 12345, type: "private" },
        from: { id: 12345, first_name: "Test", username: "testuser" },
        date: 1234567890,
        text: "Hello!",
      },
    };

    const result = await callWebhookHandler(routeHandler, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "my-secret-token",
      },
      body: JSON.stringify(update),
    });

    assert.strictEqual(result.status, 200);
    const body = JSON.parse(result.body);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(receivedMessages.length, 1);
    assert.strictEqual(receivedMessages[0].chatId, 12345);
    assert.strictEqual(receivedMessages[0].message.text, "Hello!");
  });

  test("rejects invalid secret token", async () => {
    const routeHandler = createWebhookHandler(mockConfig, mockRouter);
    receivedMessages = [];

    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 12345, type: "private" },
        date: 1234567890,
        text: "Hello!",
      },
    };

    const result = await callWebhookHandler(routeHandler, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "wrong-token",
      },
      body: JSON.stringify(update),
    });

    assert.strictEqual(result.status, 403);
    const body = JSON.parse(result.body);
    assert.ok(body.error.includes("Forbidden"));
  });

  test("rejects non-POST methods", async () => {
    const routeHandler = createWebhookHandler(mockConfig, mockRouter);

    const result = await callWebhookHandler(routeHandler, {
      method: "GET",
    });

    assert.strictEqual(result.status, 405);
    const body = JSON.parse(result.body);
    assert.ok(body.error.includes("Method not allowed"));
  });

  test("rejects invalid JSON", async () => {
    const routeHandler = createWebhookHandler(mockConfig, mockRouter);

    const result = await callWebhookHandler(routeHandler, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "my-secret-token",
      },
      body: "not json {{{",
    });

    assert.strictEqual(result.status, 400);
    const body = JSON.parse(result.body);
    assert.ok(body.error.includes("Invalid JSON"));
  });

  test("parses message.photo", async () => {
    const routeHandler = createWebhookHandler(mockConfig, mockRouter);
    receivedMessages = [];

    const update: TelegramUpdate = {
      update_id: 2,
      message: {
        message_id: 2,
        chat: { id: 12345, type: "private" },
        date: 1234567890,
        text: "Check this out",
        photo: [
          { file_id: "photo_1", file_unique_id: "uid1", width: 100, height: 100 },
          { file_id: "photo_2", file_unique_id: "uid2", width: 320, height: 320 },
        ],
      },
    };

    const result = await callWebhookHandler(routeHandler, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "my-secret-token",
      },
      body: JSON.stringify(update),
    });

    assert.strictEqual(result.status, 200);
    assert.strictEqual(receivedMessages.length, 1);
    assert.strictEqual(receivedMessages[0].message.text, "Check this out");
    assert.deepStrictEqual(receivedMessages[0].message.photo, ["photo_1", "photo_2"]);
  });

  test("parses message.document", async () => {
    const routeHandler = createWebhookHandler(mockConfig, mockRouter);
    receivedMessages = [];

    const update: TelegramUpdate = {
      update_id: 3,
      message: {
        message_id: 3,
        chat: { id: 12345, type: "private" },
        date: 1234567890,
        document: {
          file_id: "doc_1",
          file_unique_id: "doc_uid",
          file_name: "report.pdf",
          mime_type: "application/pdf",
        },
      },
    };

    const result = await callWebhookHandler(routeHandler, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "my-secret-token",
      },
      body: JSON.stringify(update),
    });

    assert.strictEqual(result.status, 200);
    assert.strictEqual(receivedMessages.length, 1);
    assert.strictEqual(receivedMessages[0].message.document, "doc_1");
  });

  test("responds quickly (async dispatch)", async () => {
    const slowRouter = {
      routeMessage: async () => {
        await new Promise((r) => setTimeout(r, 100));
      },
    };

    const handler = createWebhookHandler(mockConfig, slowRouter);

    const update: TelegramUpdate = {
      update_id: 4,
      message: {
        message_id: 4,
        chat: { id: 12345, type: "private" },
        date: 1234567890,
        text: "Hello!",
      },
    };

    const start = Date.now();
    const result = await callWebhookHandler(handler, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "my-secret-token",
      },
      body: JSON.stringify(update),
    });
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 500);
    assert.strictEqual(result.status, 200);
  });

  test("respects allowedChatIds whitelist", async () => {
    const whitelistedConfig: WebhookConfig = {
      webhookSecret: "my-secret-token",
      allowedChatIds: [99999],
    };

    const handler = createWebhookHandler(whitelistedConfig, mockRouter);
    receivedMessages = [];

    const update: TelegramUpdate = {
      update_id: 5,
      message: {
        message_id: 5,
        chat: { id: 12345, type: "private" },
        date: 1234567890,
        text: "Hello!",
      },
    };

    const result = await callWebhookHandler(handler, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "my-secret-token",
      },
      body: JSON.stringify(update),
    });

    assert.strictEqual(result.status, 200);
    assert.strictEqual(receivedMessages.length, 0);
  });

  test("handles edited_message", async () => {
    const routeHandler = createWebhookHandler(mockConfig, mockRouter);
    receivedMessages = [];

    const update: TelegramUpdate = {
      update_id: 6,
      edited_message: {
        message_id: 1,
        chat: { id: 12345, type: "private" },
        date: 1234567890,
        text: "Edited message",
      },
    };

    const result = await callWebhookHandler(routeHandler, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "my-secret-token",
      },
      body: JSON.stringify(update),
    });

    assert.strictEqual(result.status, 200);
    assert.strictEqual(receivedMessages.length, 1);
    assert.strictEqual(receivedMessages[0].message.text, "Edited message");
  });
});
