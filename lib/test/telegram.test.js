import { mock } from "node:test";
import assert from "node:assert/strict";
import { TelegramBot } from "../src/server/telegram.js";
describe("TelegramBot", () => {
    const mockToken = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
    let bot;
    beforeEach(() => {
        bot = new TelegramBot(mockToken);
    });
    function createMockResponse(ok, result, errorCode, description) {
        return {
            on: (event, handler) => {
                if (event === "data") {
                    setTimeout(() => handler(Buffer.from(JSON.stringify({ ok, result, error_code: errorCode, description }))), 0);
                }
                if (event === "end") {
                    setTimeout(() => handler(), 0);
                }
                return {};
            },
        };
    }
    it("constructs with a token", () => {
        assert.ok(bot);
    });
    it("getMe sends correct request", async () => {
        const http = await import("node:http");
        mock.method(http, "request", (_options, callback) => {
            callback(createMockResponse(true, { id: 123, is_bot: true, username: "test_bot", first_name: "Test" }));
            return {
                on: () => { },
                setTimeout: () => { },
                write: () => true,
                end: () => { },
            };
        });
        const result = await bot.getMe();
        assert.equal(result.id, 123);
        assert.equal(result.is_bot, true);
        assert.equal(result.username, "test_bot");
    });
    it("sendText sends correct request", async () => {
        const http = await import("node:http");
        mock.method(http, "request", (_options, callback) => {
            callback(createMockResponse(true, { message_id: 1 }));
            return {
                on: () => { },
                setTimeout: () => { },
                write: () => true,
                end: () => { },
            };
        });
        const result = await bot.sendText(12345, "Hello!");
        assert.ok(result);
    });
    it("sendPhoto sends correct request", async () => {
        const http = await import("node:http");
        mock.method(http, "request", (_options, callback) => {
            callback(createMockResponse(true, { message_id: 2 }));
            return {
                on: () => { },
                setTimeout: () => { },
                write: () => true,
                end: () => { },
            };
        });
        const result = await bot.sendPhoto(12345, "file_id_123", "Caption");
        assert.ok(result);
    });
    it("setWebhook sends correct request", async () => {
        const http = await import("node:http");
        mock.method(http, "request", (_options, callback) => {
            callback(createMockResponse(true, true));
            return {
                on: () => { },
                setTimeout: () => { },
                write: () => true,
                end: () => { },
            };
        });
        const result = await bot.setWebhook("https://example.com/telegram/webhook", "my-secret");
        assert.equal(result, true);
    });
    it("deleteWebhook sends correct request", async () => {
        const http = await import("node:http");
        mock.method(http, "request", (_options, callback) => {
            callback(createMockResponse(true, true));
            return {
                on: () => { },
                setTimeout: () => { },
                write: () => true,
                end: () => { },
            };
        });
        const result = await bot.deleteWebhook();
        assert.equal(result, true);
    });
    it("throws on Telegram API error", async () => {
        const http = await import("node:http");
        mock.method(http, "request", (_options, callback) => {
            callback(createMockResponse(false, null, 400, "Bad Request: chat not found"));
            return {
                on: () => { },
                setTimeout: () => { },
                write: () => true,
                end: () => { },
            };
        });
        await assert.rejects(() => bot.sendText(12345, "Hello!"), { message: "Telegram API error (400): Bad Request: chat not found" });
    });
    it("retries on 429 with delay", async () => {
        const http = await import("node:http");
        let callCount = 0;
        mock.method(http, "request", (_options, callback) => {
            callCount++;
            if (callCount < 3) {
                callback(createMockResponse(false, null, 429, "Too Many Requests"));
            }
            else {
                callback(createMockResponse(true, { message_id: 1 }));
            }
            return {
                on: () => { },
                setTimeout: () => { },
                write: () => true,
                end: () => { },
            };
        });
        const start = Date.now();
        await bot.sendText(12345, "Hello!");
        const elapsed = Date.now() - start;
        assert.equal(callCount, 3);
        assert.ok(elapsed >= 1000, `Expected delay from retries, got ${elapsed}ms`);
    });
    it("throws after max retries on 500", async () => {
        const http = await import("node:http");
        mock.method(http, "request", (_options, callback) => {
            callback(createMockResponse(false, null, 500, "Internal Server Error"));
            return {
                on: () => { },
                setTimeout: () => { },
                write: () => true,
                end: () => { },
            };
        });
        await assert.rejects(() => bot.sendText(12345, "Hello!"), { message: /Telegram API server error/ });
    });
});
//# sourceMappingURL=telegram.test.js.map