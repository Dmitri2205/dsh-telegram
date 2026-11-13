import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "../src/server/router.ts";
import { setChatsFile } from "../src/server/state.ts";
import { createFakeContext } from "./helper.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeTempChatsFile(): string {
  return join(tmpdir(), `dsh-telegram-status-test-${Date.now()}.json`);
}

async function makeRunningHandle(sessionId: string, opts?: any) {
  const record: {
    sessionId: string;
    followupCalls: any[];
    disposed: number;
    cancelled: number;
    lastCancelKind?: string;
  } = {
    sessionId,
    followupCalls: [],
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

// ── Tests ─────────────────────────────────────────────────────────────────

test("Router.getStatus — /status command", async () => {
  const tmpFile = makeTempChatsFile();

  try {
    // --- Test 1: no session → "нет активной сессии" ---
    {
      const messages: Array<{ chatId: number; text: string }> = [];
      const mockBot = {
        sendText: async (chatId: number | string, text: string) => {
          messages.push({ chatId: Number(chatId), text });
        },
      };

      const ctx = createFakeContext();
      (ctx as any).logger = {
        debug: () => {}, info: () => {}, warn: () => {},
        error: (msg: string) => console.log("ERROR:", msg),
      };
      const router = createRouter(mockBot, ctx as any);
      ctx.agents.eventSink = (sessionId: string, event: any) => router.handleSessionEvent(sessionId, event);

      const result = await router.getStatus(11111);
      assert.ok(result.text.toLowerCase().includes("нет активной сессии"), `Expected "нет активной сессии", got: ${result.text}`);
      assert.ok(result.text.toLowerCase().includes("/new"), `Expected "/new" reference, got: ${result.text}`);

      // Also via routeMessage — /status is a command, answered locally
      messages.length = 0;
      await router.routeMessage(11111, { text: "/status" });
      assert.strictEqual(messages.length, 1);
      assert.ok(messages[0].text.toLowerCase().includes("нет активной сессии"));
    }

    // --- Test 2: idle agent (live) ---
    {
      const messages: Array<{ chatId: number; text: string }> = [];
      const mockBot = {
        sendText: async (chatId: number | string, text: string) => {
          messages.push({ chatId: Number(chatId), text });
        },
      };

      const ctx = createFakeContext();
      (ctx as any).logger = {
        debug: () => {}, info: () => {}, warn: () => {},
        error: (msg: string) => console.log("ERROR:", msg),
      };
      const router = createRouter(mockBot, ctx as any);
      ctx.agents.eventSink = (sessionId: string, event: any) => router.handleSessionEvent(sessionId, event);

      // Send a message to create an idle agent
      await router.routeMessage(22222, { text: "Hello!" });
      assert.strictEqual(messages.length, 1);

      // Now check status
      const result = await router.getStatus(22222);
      assert.ok(result.text.includes("Сессия:"), `Expected "Сессия:", got: ${result.text}`);
      assert.ok(result.text.includes("idle"), `Expected "idle", got: ${result.text}`);
    }

    // --- Test 3: running agent (live) ---
    {
      const messages: Array<{ chatId: number; text: string }> = [];
      const mockBot = {
        sendText: async (chatId: number | string, text: string) => {
          messages.push({ chatId: Number(chatId), text });
        },
      };

      const ctx = createFakeContext();
      (ctx as any).logger = {
        debug: () => {}, info: () => {}, warn: () => {},
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

      // Create a running agent via routeMessage
      await router.routeMessage(33333, { text: "Generate something..." });
      assert.ok(handleRef, "handleRef should be set");
      assert.strictEqual(handleRef.agent.status, "running");

      const result = await router.getStatus(33333);
      assert.ok(result.text.includes("Сессия:"), `Expected "Сессия:", got: ${result.text}`);
      assert.ok(result.text.includes("running"), `Expected "running", got: ${result.text}`);

      ctx.agents.create = originalCreate;
    }

    // --- Test 4: session in persistence but agent not alive → idle + eventCount ---
    {
      const messages: Array<{ chatId: number; text: string }> = [];
      const mockBot = {
        sendText: async (chatId: number | string, text: string) => {
          messages.push({ chatId: Number(chatId), text });
        },
      };

      // Simulate: save a sessionId in state (as /new would do)
      const testChatId = 44444;
      setChatsFile(tmpFile);
      writeFileSync(tmpFile, JSON.stringify({
        chats: {
          [String(testChatId)]: {
            chatId: testChatId,
            sessionId: "persisted-session-abc123",
            workspacePath: "/tmp/test-ws",
            lastStatus: "running",
            updatedAt: new Date().toISOString(),
          },
        },
      }, null, 2));

      // Create router with sessionPersistence mock
      const statCalled: { sessionId?: string; eventCount?: number } = {};
      const mockPersistence = {
        stat: async (sessionId: string) => {
          statCalled.sessionId = sessionId;
          statCalled.eventCount = 148;
          return { eventCount: 148 };
        },
      };

      const ctx2 = createFakeContext();
      (ctx2 as any).logger = {
        debug: () => {}, info: () => {}, warn: () => {},
        error: (msg: string) => console.log("ERROR:", msg),
      };
      const router2 = createRouter(mockBot, ctx2 as any & { sessionPersistence?: unknown });
      (ctx2 as any).sessionPersistence = mockPersistence;

      // No live agent — status should show idle + eventCount from persistence
      const result = await router2.getStatus(testChatId);
      assert.ok(result.text.includes("Сессия:"), `Expected "Сессия:", got: ${result.text}`);
      assert.ok(result.text.includes("idle"), `Expected "idle", got: ${result.text}`);
      assert.ok(result.text.includes("148"), `Expected eventCount 148, got: ${result.text}`);
      assert.strictEqual(statCalled.sessionId, "persisted-session-abc123", "stat called with correct sessionId");
    }

    // --- Test 5: /status via routeMessage creates no agent turn ---
    {
      const messages: Array<{ chatId: number; text: string }> = [];
      const mockBot = {
        sendText: async (chatId: number | string, text: string) => {
          messages.push({ chatId: Number(chatId), text });
        },
      };

      // Set state with a sessionId so status doesn't say "no session"
      setChatsFile(tmpFile);
      writeFileSync(tmpFile, JSON.stringify({
        chats: {
          [String(55555)]: {
            chatId: 55555,
            sessionId: "session-for-route-test",
            updatedAt: new Date().toISOString(),
          },
        },
      }, null, 2));

      const ctx = createFakeContext();
      (ctx as any).logger = {
        debug: () => {}, info: () => {}, warn: () => {},
        error: (msg: string) => console.log("ERROR:", msg),
      };
      const router = createRouter(mockBot, ctx as any);
      ctx.agents.eventSink = (sessionId: string, event: any) => router.handleSessionEvent(sessionId, event);

      // Send /status — should NOT trigger agent creation
      await router.routeMessage(55555, { text: "/status" });
      assert.strictEqual(messages.length, 1);
      assert.ok(messages[0].text.includes("Сессия:"), `Expected "Сессия:", got: ${messages[0].text}`);

      // Verify no agent was created (no followup calls)
      const createdSessions = ctx.agents.created;
      assert.strictEqual(createdSessions.length, 0, "No agent should be created by /status");
    }
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
});
