import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "../src/server/router.ts";
import { createFakeContext } from "./helper.ts";

test("Router", async () => {
  let messages: Array<{ chatId: number; text: string }> = [];

  const mockBot = {
    sendText: async (chatId: number | string, text: string) => {
      messages.push({ chatId: Number(chatId), text });
    },
  };

  test("creates a new agent for a new chatId", async () => {
    messages = [];
    const ctx = createFakeContext();
    (ctx as any).logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (msg: string) => console.log("ERROR:", msg),
    };
    const router = createRouter(mockBot, ctx as any);

    await router.routeMessage(12345, { text: "Hello!" });

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].chatId, 12345);
    assert.strictEqual(messages[0].text, "test response");
    assert.ok(ctx.agents.created.length > 0);
  });

  test("caches chatId → agent for subsequent messages", async () => {
    messages = [];
    const ctx = createFakeContext();
    (ctx as any).logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (msg: string) => console.log("ERROR:", msg),
    };
    const router = createRouter(mockBot, ctx as any);

    await router.routeMessage(12345, { text: "First" });
    const createdCount1 = ctx.agents.created.length;

    await router.routeMessage(12345, { text: "Second" });
    const createdCount2 = ctx.agents.created.length;

    assert.strictEqual(createdCount1, 1);
    assert.strictEqual(createdCount2, 1);
    assert.strictEqual(messages.length, 2);
  });

  test("newSession resets the session for a chatId", async () => {
    messages = [];
    const ctx = createFakeContext();
    (ctx as any).logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (msg: string) => console.log("ERROR:", msg),
    };
    const router = createRouter(mockBot, ctx as any);

    await router.routeMessage(12345, { text: "First" });
    assert.ok(ctx.agents.created.length > 0);

    router.newSession(12345);

    await router.routeMessage(12345, { text: "After reset" });
    assert.strictEqual(ctx.agents.created.length, 2);
  });

  test("listSessions returns active sessions", () => {
    const ctx = createFakeContext();
    (ctx as any).logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (msg: string) => console.log("ERROR:", msg),
    };
    const router = createRouter(mockBot, ctx as any);

    const sessions = router.listSessions();
    assert.ok(Array.isArray(sessions));
  });

  test("handles agent creation errors gracefully", async () => {
    messages = [];
    const brokenCtx = createFakeContext();
    brokenCtx.agents.create = async () => {
      throw new Error("Agent service unavailable");
    };
    brokenCtx.logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    const brokenRouter = createRouter(mockBot, brokenCtx as any);
    await brokenRouter.routeMessage(12345, { text: "Hello!" });

    assert.strictEqual(messages.length, 1);
    assert.ok(messages[0].text.includes("Failed to process"));
  });
});
