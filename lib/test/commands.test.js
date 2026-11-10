import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, handleCommand } from "../src/server/commands.js";
describe("parseCommand", () => {
    it("parses /start", () => {
        const result = parseCommand("/start");
        assert.ok(result);
        assert.equal(result.command, "start");
        assert.deepStrictEqual(result.args, []);
    });
    it("parses /start with args", () => {
        const result = parseCommand("/start arg1 arg2");
        assert.ok(result);
        assert.equal(result.command, "start");
        assert.deepStrictEqual(result.args, ["arg1", "arg2"]);
    });
    it("parses /new", () => {
        const result = parseCommand("/new");
        assert.ok(result);
        assert.equal(result.command, "new");
        assert.deepStrictEqual(result.args, []);
    });
    it("parses /help", () => {
        const result = parseCommand("/help");
        assert.ok(result);
        assert.equal(result.command, "help");
        assert.deepStrictEqual(result.args, []);
    });
    it("parses /list", () => {
        const result = parseCommand("/list");
        assert.ok(result);
        assert.equal(result.command, "list");
        assert.deepStrictEqual(result.args, []);
    });
    it("parses /command@botname", () => {
        const result = parseCommand("/start@mybot");
        assert.ok(result);
        assert.equal(result.command, "start");
        assert.deepStrictEqual(result.args, []);
    });
    it("returns null for non-command text", () => {
        assert.equal(parseCommand("Hello"), null);
        assert.equal(parseCommand("/"), null);
        assert.equal(parseCommand(""), null);
        assert.equal(parseCommand(null), null);
        assert.equal(parseCommand("  /start"), null); // leading space
    });
    it("normalizes command to lowercase", () => {
        const result = parseCommand("/START");
        assert.ok(result);
        assert.equal(result.command, "start");
    });
});
describe("handleCommand", () => {
    let mockBot;
    let mockRouter;
    beforeEach(() => {
        mockBot = {
            sendText: async (_chatId, _text) => { },
        };
        mockRouter = {
            newSession: () => { },
            listSessions: () => [],
        };
    });
    it("/start creates new session", async () => {
        let sessionCreated = false;
        mockRouter.newSession = () => { sessionCreated = true; };
        const result = await handleCommand("start", [], 12345, mockBot, mockRouter);
        assert.equal(result.action, "new_session");
        assert.ok(sessionCreated);
        assert.ok(result.text.includes("Welcome"));
    });
    it("/new creates new session", async () => {
        let sessionCreated = false;
        mockRouter.newSession = () => { sessionCreated = true; };
        const result = await handleCommand("new", [], 12345, mockBot, mockRouter);
        assert.equal(result.action, "new_session");
        assert.ok(sessionCreated);
        assert.ok(result.text.includes("New session"));
    });
    it("/help shows commands", async () => {
        const result = await handleCommand("help", [], 12345, mockBot, mockRouter);
        assert.equal(result.action, "send");
        assert.ok(result.text.includes("/start"));
        assert.ok(result.text.includes("/new"));
        assert.ok(result.text.includes("/list"));
    });
    it("/list shows sessions", async () => {
        mockRouter.listSessions = () => [
            { chatId: 12345, sessionId: "session-1" },
            { chatId: 67890, sessionId: "session-2" },
        ];
        const result = await handleCommand("list", [], 12345, mockBot, mockRouter);
        assert.equal(result.action, "list");
        assert.ok(result.text.includes("Active sessions (2)"));
        assert.ok(result.text.includes("session-1"));
        assert.ok(result.text.includes("session-2"));
    });
    it("/list shows empty when no sessions", async () => {
        mockRouter.listSessions = () => [];
        const result = await handleCommand("list", [], 12345, mockBot, mockRouter);
        assert.equal(result.action, "send");
        assert.ok(result.text.includes("No active sessions"));
    });
    it("unknown command returns error", async () => {
        const result = await handleCommand("unknown", [], 12345, mockBot, mockRouter);
        assert.equal(result.action, "send");
        assert.ok(result.text.includes("Unknown command"));
    });
    it("resets session on /start", async () => {
        let lastChatId = null;
        mockRouter.newSession = (chatId) => { lastChatId = chatId; };
        await handleCommand("start", [], 12345, mockBot, mockRouter);
        assert.equal(lastChatId, 12345);
    });
});
//# sourceMappingURL=commands.test.js.map