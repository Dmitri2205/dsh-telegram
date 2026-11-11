import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, handleCommand } from "../src/server/commands.ts";

test("parseCommand", async () => {
  test("parses /start", () => {
    const result = parseCommand("/start");
    assert.ok(result !== null);
    assert.strictEqual(result!.command, "start");
    assert.deepStrictEqual(result!.args, []);
  });

  test("parses /start with args", () => {
    const result = parseCommand("/start arg1 arg2");
    assert.ok(result !== null);
    assert.strictEqual(result!.command, "start");
    assert.deepStrictEqual(result!.args, ["arg1", "arg2"]);
  });

  test("parses /new", () => {
    const result = parseCommand("/new");
    assert.ok(result !== null);
    assert.strictEqual(result!.command, "new");
    assert.deepStrictEqual(result!.args, []);
  });

  test("parses /help", () => {
    const result = parseCommand("/help");
    assert.ok(result !== null);
    assert.strictEqual(result!.command, "help");
    assert.deepStrictEqual(result!.args, []);
  });

  test("parses /list", () => {
    const result = parseCommand("/list");
    assert.ok(result !== null);
    assert.strictEqual(result!.command, "list");
    assert.deepStrictEqual(result!.args, []);
  });

  test("parses /command@botname", () => {
    const result = parseCommand("/start@mybot");
    assert.ok(result !== null);
    assert.strictEqual(result!.command, "start");
    assert.deepStrictEqual(result!.args, []);
  });

  test("returns null for non-command text", () => {
    assert.strictEqual(parseCommand("Hello"), null);
    assert.strictEqual(parseCommand("/"), null);
    assert.strictEqual(parseCommand(""), null);
    assert.strictEqual(parseCommand(null as any), null);
    assert.strictEqual(parseCommand("  /start"), null);
  });

  test("normalizes command to lowercase", () => {
    const result = parseCommand("/START");
    assert.ok(result !== null);
    assert.strictEqual(result!.command, "start");
  });
});

test("handleCommand", async () => {
  let sessionCreated = false;
  let lastChatId: number | null = null;

  const mockRouter = {
    newSession: (chatId?: number) => {
      if (chatId !== undefined) lastChatId = chatId;
      sessionCreated = true;
    },
    listSessions: (): Array<{ chatId: number; sessionId: string }> => [],
  };

  test("/start creates new session", async () => {
    sessionCreated = false;
    const result = await handleCommand("start", [], 12345, mockRouter);
    assert.strictEqual(result.action, "new_session");
    assert.ok(sessionCreated);
    assert.ok(result.text!.includes("Welcome"));
  });

  test("/new creates new session", async () => {
    sessionCreated = false;
    const result = await handleCommand("new", [], 12345, mockRouter);
    assert.strictEqual(result.action, "new_session");
    assert.ok(sessionCreated);
    assert.ok(result.text!.includes("New session"));
  });

  test("/help shows commands", async () => {
    const result = await handleCommand("help", [], 12345, mockRouter);
    assert.strictEqual(result.action, "send");
    assert.ok(result.text!.includes("/start"));
    assert.ok(result.text!.includes("/new"));
    assert.ok(result.text!.includes("/list"));
  });

  test("/list shows sessions", async () => {
    mockRouter.listSessions = () => [
      { chatId: 12345, sessionId: "session-1" },
      { chatId: 67890, sessionId: "session-2" },
    ];

    const result = await handleCommand("list", [], 12345, mockRouter);
    assert.strictEqual(result.action, "list");
    assert.ok(result.text!.includes("Active sessions (2)"));
    assert.ok(result.text!.includes("session-1"));
    assert.ok(result.text!.includes("session-2"));
  });

  test("/list shows empty when no sessions", async () => {
    mockRouter.listSessions = () => [];

    const result = await handleCommand("list", [], 12345, mockRouter);
    assert.strictEqual(result.action, "send");
    assert.ok(result.text!.includes("No active sessions"));
  });

  test("unknown command returns error", async () => {
    const result = await handleCommand("unknown", [], 12345, mockRouter);
    assert.strictEqual(result.action, "send");
    assert.ok(result.text!.includes("Unknown command"));
  });

  test("resets session on /start", async () => {
    lastChatId = null;
    await handleCommand("start", [], 12345, mockRouter);
    assert.strictEqual(lastChatId, 12345);
  });
});
