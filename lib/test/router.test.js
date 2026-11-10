import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "../src/server/router.js";
import { createFakeContext } from "./helper.js";
describe("Router", () => {
    let messages = [];
    let router;
    let ctx;
    const mockBot = {
        sendText: async (chatId, text) => {
            messages.push({ chatId: Number(chatId), text });
        },
    };
    beforeEach(() => {
        messages = [];
        ctx = createFakeContext();
        ctx.logger = {
            info: () => { },
            error: (msg) => console.log("ERROR:", msg),
        };
        router = createRouter(mockBot, ctx);
    });
    it("creates a new agent for a new chatId", async () => {
        await router.routeMessage(12345, { text: "Hello!" });
        assert.equal(messages.length, 1);
        assert.equal(messages[0].chatId, 12345);
        assert.equal(messages[0].text, "test response");
        assert.ok(ctx.agents.created.length > 0, "Should have created a new agent");
    });
    it("caches chatId → agent for subsequent messages", async () => {
        // First message — creates agent
        await router.routeMessage(12345, { text: "First" });
        const createdCount1 = ctx.agents.created.length;
        // Second message — should use cached agent, not create new
        await router.routeMessage(12345, { text: "Second" });
        const createdCount2 = ctx.agents.created.length;
        assert.equal(createdCount1, 1);
        assert.equal(createdCount2, 1, "Should not create a second agent for the same chatId");
        assert.equal(messages.length, 2);
    });
    it("newSession resets the session for a chatId", async () => {
        // Create a session
        await router.routeMessage(12345, { text: "First" });
        assert.ok(ctx.agents.created.length > 0);
        // Reset session
        router.newSession(12345);
        // Next message should create a new agent
        await router.routeMessage(12345, { text: "After reset" });
        assert.equal(ctx.agents.created.length, 2, "Should create a new agent after reset");
    });
    it("listSessions returns active sessions", () => {
        const sessions = router.listSessions();
        assert.ok(Array.isArray(sessions));
    });
    it("handles agent creation errors gracefully", async () => {
        const brokenCtx = createFakeContext();
        // Break the agents.create to throw
        brokenCtx.agents.create = async () => {
            throw new Error("Agent service unavailable");
        };
        brokenCtx.logger = {
            info: () => { },
            error: () => { },
        };
        const brokenRouter = createRouter(mockBot, brokenCtx);
        await brokenRouter.routeMessage(12345, { text: "Hello!" });
        // Should have sent an error message
        assert.equal(messages.length, 1);
        assert.ok(messages[0].text.includes("Failed to process"));
    });
});
//# sourceMappingURL=router.test.js.map