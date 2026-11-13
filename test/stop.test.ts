import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouter, AgentHandle } from "../src/server/router.ts";
import { createFakeContext } from "./helper.ts";

test("Router.stop", async () => {
  let messages: Array<{ chatId: number; text: string }> = [];

  const mockBot = {
    sendText: async (chatId: number | string, text: string) => {
      messages.push({ chatId: Number(chatId), text });
    },
  };

  test("stop on unknown chatId returns false", async () => {
    const ctx = createFakeContext();
    (ctx as any).logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (msg: string) => console.log("ERROR:", msg),
    };
    const router = createRouter(mockBot, ctx as any);
    ctx.agents.eventSink = (sessionId: string, event: any) => router.handleSessionEvent(sessionId, event);

    const stopped = await router.stop(99999);
    assert.strictEqual(stopped, false);
  });

  test("stop on idle agent returns false — /stop gives refusal", async () => {
    messages = [];
    const ctx = createFakeContext();
    (ctx as any).logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (msg: string) => console.log("ERROR:", msg),
    };
    const router = createRouter(mockBot, ctx as any);
    ctx.agents.eventSink = (sessionId: string, event: any) => router.handleSessionEvent(sessionId, event);

    // First message creates an agent and it goes idle after responding
    await router.routeMessage(12345, { text: "Hello!" });
    assert.strictEqual(messages.length, 1);

    // Agent is now idle — stop should return false
    const stopped = await router.stop(12345);
    assert.strictEqual(stopped, false);

    // Bot does NOT reply when stop() called directly (reply comes from handleCommand)
    assert.strictEqual(messages.length, 1);
  });

  test("/stop via routeMessage — idle agent gets refusal", async () => {
    messages = [];
    const ctx = createFakeContext();
    (ctx as any).logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (msg: string) => console.log("ERROR:", msg),
    };
    const router = createRouter(mockBot, ctx as any);
    ctx.agents.eventSink = (sessionId: string, event: any) => router.handleSessionEvent(sessionId, event);

    // First message creates an agent and it goes idle after responding
    await router.routeMessage(12345, { text: "Hello!" });
    assert.strictEqual(messages.length, 1);

    // Send /stop — should trigger handleCommand → stop → refusal reply
    await router.routeMessage(12345, { text: "/stop" });

    // Two messages: initial response + stop refusal
    assert.strictEqual(messages.length, 2);
    assert.ok(messages[1].text.includes("Нечего останавливать"));
  });

  test("/cancel via routeMessage — alias works for idle agent", async () => {
    messages = [];
    const ctx = createFakeContext();
    (ctx as any).logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (msg: string) => console.log("ERROR:", msg),
    };
    const router = createRouter(mockBot, ctx as any);
    ctx.agents.eventSink = (sessionId: string, event: any) => router.handleSessionEvent(sessionId, event);

    await router.routeMessage(12345, { text: "Hello!" });

    // Send /cancel — should trigger handleCommand → stop → refusal reply
    await router.routeMessage(12345, { text: "/cancel" });

    assert.strictEqual(messages.length, 2);
    assert.ok(messages[1].text.includes("Нечего останавливать"));
  });

  test("/stop on running agent — cancels and replies", async () => {
    messages = [];
    const ctx = createFakeContext();
    (ctx as any).logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (msg: string) => console.log("ERROR:", msg),
    };

    let handleRef: any = null;
    const originalCreate = ctx.agents.create;
    ctx.agents.create = async (opts: any) => {
      const handle = await makeRunningHandle(opts?.sessionId ?? "session-running", opts);
      handleRef = handle;
      return handle;
    };

    const router = createRouter(mockBot, ctx as any);
    ctx.agents.eventSink = (sessionId: string, event: any) => router.handleSessionEvent(sessionId, event);

    // Send a message — creates agent in "running" state
    await router.routeMessage(12345, { text: "Generate something long..." });

    // Verify the agent was created and is running
    assert.ok(handleRef, "handleRef should be set");
    assert.strictEqual(handleRef.agent.status, "running");

    // Send /stop — should cancel the running agent
    await router.routeMessage(12345, { text: "/stop" });

    // Verify cancel was called exactly once with { kind: 'user' }
    assert.strictEqual(handleRef.record.cancelled, 1);
    assert.deepStrictEqual(handleRef.record.lastCancelKind, "user");

    // Bot should have replied with stop confirmation
    const stopMsg = messages.find((m) => m.text.includes("остановлена"));
    assert.ok(stopMsg, "stop reply should contain 'остановлена'");
    assert.strictEqual(stopMsg.chatId, 12345);

    // Agent should be cleaned up from cache
    const stoppedAgain = await router.stop(12345);
    assert.strictEqual(stoppedAgain, false);

    ctx.agents.create = originalCreate;
  });

  test("stop response contains 'остановлено' text", async () => {
    messages = [];
    const ctx = createFakeContext();
    (ctx as any).logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (msg: string) => console.log("ERROR:", msg),
    };

    let handleRef: any = null;
    const originalCreate = ctx.agents.create;
    ctx.agents.create = async (opts: any) => {
      const handle = await makeRunningHandle(opts?.sessionId ?? "session-running", opts);
      handleRef = handle;
      return handle;
    };

    const router = createRouter(mockBot, ctx as any);
    ctx.agents.eventSink = (sessionId: string, event: any) => router.handleSessionEvent(sessionId, event);

    await router.routeMessage(12345, { text: "Generate..." });
    await router.routeMessage(12345, { text: "/stop" });

    // Find the stop reply in messages
    const stopMsg = messages.find((m) => m.text.includes("остановлена"));
    assert.ok(stopMsg, "stop reply should contain 'остановлена'");
    assert.strictEqual(stopMsg.chatId, 12345);

    ctx.agents.create = originalCreate;
  });
});

async function makeRunningHandle(sessionId: string, opts: any) {
  const record: {
    sessionId: string;
    followupCalls: any[];
    disposed: number;
    cancelled: number;
    lastCancelKind?: string;
  } = {
    sessionId,
    followupCalls: [] as any[],
    disposed: 0,
    cancelled: 0,
  };
  let status: "idle" | "running" = "running";

  const agent = {
    id: sessionId,
    session: { id: sessionId },
    get status() { return status; },
    set status(s: "idle" | "running") { status = s; },
    followup: (message: any) => {
      record.followupCalls.push(message);
    },
    whenIdle: async () => {
      // Simulate actual running delay
      await new Promise((r) => setTimeout(r, 0));
    },
    cancel: (options?: { kind?: string }) => {
      record.cancelled += 1;
      record.lastCancelKind = options?.kind;
      status = "idle";
    },
  };

  const handle = {
    agent,
    record,
    dispose: async () => { record.disposed += 1; },
  };

  return handle;
}
