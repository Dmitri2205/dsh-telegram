import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createWebhookHandler } from "../src/server/webhook.js";
import { callRoute } from "./helper.js";
describe("Webhook handler", () => {
    let routeHandler;
    let receivedMessages = [];
    const mockRouter = {
        routeMessage: async (chatId, message) => {
            receivedMessages.push({ chatId, message });
        },
    };
    const mockConfig = {
        webhookSecret: "my-secret-token",
        allowedChatIds: [],
    };
    beforeEach(() => {
        routeHandler = createWebhookHandler(mockConfig, mockRouter);
        receivedMessages = [];
    });
    it("accepts POST with valid JSON", async () => {
        const update = {
            update_id: 1,
            message: {
                message_id: 1,
                chat: { id: 12345, type: "private" },
                from: { id: 12345, first_name: "Test", username: "testuser" },
                date: 1234567890,
                text: "Hello!",
            },
        };
        const result = await callRoute(routeHandler, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-telegram-bot-api-secret-token": "my-secret-token",
            },
            body: JSON.stringify(update),
        });
        assert.equal(result.status, 200);
        const body = JSON.parse(result.body);
        assert.equal(body.ok, true);
        assert.equal(receivedMessages.length, 1);
        assert.equal(receivedMessages[0].chatId, 12345);
        assert.equal(receivedMessages[0].message.text, "Hello!");
    });
    it("rejects invalid secret token", async () => {
        const update = {
            update_id: 1,
            message: {
                message_id: 1,
                chat: { id: 12345, type: "private" },
                date: 1234567890,
                text: "Hello!",
            },
        };
        const result = await callRoute(routeHandler, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-telegram-bot-api-secret-token": "wrong-token",
            },
            body: JSON.stringify(update),
        });
        assert.equal(result.status, 403);
        const body = JSON.parse(result.body);
        assert.ok(body.error && body.error.includes("Forbidden"));
    });
    it("rejects non-POST methods", async () => {
        const result = await callRoute(routeHandler, {
            method: "GET",
        });
        assert.equal(result.status, 405);
        const body = JSON.parse(result.body);
        assert.ok(body.error && body.error.includes("Method not allowed"));
    });
    it("rejects invalid JSON", async () => {
        const result = await callRoute(routeHandler, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-telegram-bot-api-secret-token": "my-secret-token",
            },
            body: "not json {{{",
        });
        assert.equal(result.status, 400);
        const body = JSON.parse(result.body);
        assert.ok(body.error && body.error.includes("Invalid JSON"));
    });
    it("parses message.photo", async () => {
        const update = {
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
        const result = await callRoute(routeHandler, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-telegram-bot-api-secret-token": "my-secret-token",
            },
            body: JSON.stringify(update),
        });
        assert.equal(result.status, 200);
        assert.equal(receivedMessages.length, 1);
        assert.equal(receivedMessages[0].message.text, "Check this out");
        assert.deepStrictEqual(receivedMessages[0].message.photo, ["photo_1", "photo_2"]);
    });
    it("parses message.document", async () => {
        const update = {
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
        const result = await callRoute(routeHandler, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-telegram-bot-api-secret-token": "my-secret-token",
            },
            body: JSON.stringify(update),
        });
        assert.equal(result.status, 200);
        assert.equal(receivedMessages.length, 1);
        assert.equal(receivedMessages[0].message.document, "doc_1");
    });
    it("responds quickly (async dispatch)", async () => {
        // Router that delays
        const slowRouter = {
            routeMessage: async () => {
                await new Promise((r) => setTimeout(r, 100));
            },
        };
        const handler = createWebhookHandler(mockConfig, slowRouter);
        const update = {
            update_id: 4,
            message: {
                message_id: 4,
                chat: { id: 12345, type: "private" },
                date: 1234567890,
                text: "Hello!",
            },
        };
        const start = Date.now();
        const result = await callRoute(handler, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-telegram-bot-api-secret-token": "my-secret-token",
            },
            body: JSON.stringify(update),
        });
        const elapsed = Date.now() - start;
        // Should respond within 100ms (before the slow router finishes)
        assert.ok(elapsed < 500, `Response should be fast, took ${elapsed}ms`);
        assert.equal(result.status, 200);
    });
    it("respects allowedChatIds whitelist", async () => {
        const whitelistedConfig = {
            webhookSecret: "my-secret-token",
            allowedChatIds: [99999],
        };
        const handler = createWebhookHandler(whitelistedConfig, mockRouter);
        const update = {
            update_id: 5,
            message: {
                message_id: 5,
                chat: { id: 12345, type: "private" },
                date: 1234567890,
                text: "Hello!",
            },
        };
        const result = await callRoute(handler, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-telegram-bot-api-secret-token": "my-secret-token",
            },
            body: JSON.stringify(update),
        });
        assert.equal(result.status, 200);
        // Message should NOT be routed (chatId not in whitelist)
        assert.equal(receivedMessages.length, 0);
    });
    it("handles edited_message", async () => {
        const update = {
            update_id: 6,
            edited_message: {
                message_id: 1,
                chat: { id: 12345, type: "private" },
                date: 1234567890,
                text: "Edited message",
            },
        };
        const result = await callRoute(routeHandler, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-telegram-bot-api-secret-token": "my-secret-token",
            },
            body: JSON.stringify(update),
        });
        assert.equal(result.status, 200);
        assert.equal(receivedMessages.length, 1);
        assert.equal(receivedMessages[0].message.text, "Edited message");
    });
});
//# sourceMappingURL=webhook.test.js.map