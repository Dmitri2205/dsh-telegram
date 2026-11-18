import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "../src/server/router.ts";
import { setChatsFile, getChatsFilePath } from "../src/server/state.ts";
import { existsSync, writeFileSync, unlinkSync, mkdirSync, readdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";

// ── Helpers ─────────────────────────────────────────────────────────────

const TEST_DIR = "/tmp/dsh-telegram-list-test-" + process.pid;

function ensureTestDir(): void {
  mkdirSync(TEST_DIR, { recursive: true });
}

function setTestFile(name: string): void {
  ensureTestDir();
  setChatsFile(join(TEST_DIR, name));
}

function clearChatsFile(): void {
  const file = getChatsFilePath();
  if (existsSync(file)) unlinkSync(file);
}

function cleanupDir(): void {
  try {
    if (existsSync(TEST_DIR)) {
      for (const f of readdirSync(TEST_DIR)) {
        try { unlinkSync(join(TEST_DIR, f)); } catch {}
      }
      try { rmdirSync(TEST_DIR); } catch {}
    }
  } catch {}
}

function writeChatsFile(chatId: number, workspacePath: string, sessionId?: string): void {
  ensureTestDir();
  const file = getChatsFilePath();
  const entry: Record<string, unknown> = {
    chatId,
    workspacePath,
    updatedAt: new Date().toISOString(),
  };
  if (sessionId) {
    entry.sessionId = sessionId;
  }
  const store = {
    chats: {
      [String(chatId)]: entry,
    },
  };
  writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
}

// ── Tests ───────────────────────────────────────────────────────────────

test("Router.listWorkspaceSessions — /list command", async () => {
  const mockBot = {
    sendText: async (_chatId: number | string, _text: string) => {},
  };

  // --- Test 1: no workspace selected → error ---
  {
    setTestFile("t1.json");
    clearChatsFile();

    const ctx: any = {
      agents: {
        create: async () => ({
          agent: { id: "s", session: { id: "s" } },
          dispose: async () => {},
        }),
      },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    };

    const router = createRouter(mockBot, ctx);

    const result = await (router as any).listWorkspaceSessions(11111);
    assert.ok(result.text.includes("⚠️"), `Expected ⚠️, got: ${result.text}`);
    assert.ok(result.text.includes("/ws"), `Expected mention of /ws, got: ${result.text}`);
  }

  // --- Test 2: workspace selected but no persisted sessions → empty ---
  {
    setTestFile("t2.json");
    clearChatsFile();
    writeChatsFile(22222, "/tmp/empty-ws");

    const ctx: any = {
      agents: {
        create: async () => ({
          agent: { id: "s", session: { id: "s" } },
          dispose: async () => {},
        }),
      },
      sessionPersistence: {
        list: async (_cwd?: string) => [],
      },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    };

    const router = createRouter(mockBot, ctx);

    const result = await (router as any).listWorkspaceSessions(22222);
    assert.ok(result.text.includes("не найдено"), `Expected "не найдено", got: ${result.text}`);
  }

  // --- Test 3: sessions listed with correct format ---
  {
    setTestFile("t3.json");
    clearChatsFile();
    writeChatsFile(33333, "/tmp/ws3", "telegram-33333-active");

    const now = new Date();
    const session1 = {
      sessionId: "telegram-33333-active",
      cwd: "/tmp/ws3",
      createdAt: now.toISOString(),
      eventCount: 42,
    };
    const session2 = {
      sessionId: "telegram-33333-old",
      cwd: "/tmp/ws3",
      createdAt: new Date(now.getTime() - 3600000).toISOString(),
      eventCount: 10,
    };

    const ctx: any = {
      agents: {
        create: async () => ({
          agent: { id: "s", session: { id: "s" } },
          dispose: async () => {},
        }),
      },
      sessionPersistence: {
        list: async (_cwd?: string) => [session1, session2],
      },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    };

    const router = createRouter(mockBot, ctx);

    const result = await (router as any).listWorkspaceSessions(33333);

    assert.ok(result.text.includes("telegram-33333-act"), "Should show session ids");
    assert.ok(result.text.includes("▶ "), "Current session should be marked with ▶");
    assert.ok(result.text.includes("42"), "Should show eventCount");
    assert.ok(result.text.includes("10"), "Should show eventCount for other session");
    assert.ok(result.text.includes("Сессии"), "Should show count header");
  }

  // --- Test 4: filter by cwd — sessions from other workspaces excluded ---
  {
    setTestFile("t4.json");
    clearChatsFile();
    writeChatsFile(44444, "/tmp/ws4");

    const now = new Date();
    const sessions = [
      {
        sessionId: "telegram-44444-ok",
        cwd: "/tmp/ws4",
        createdAt: now.toISOString(),
        eventCount: 5,
      },
      {
        sessionId: "telegram-99999-other",
        cwd: "/tmp/other-ws",
        createdAt: now.toISOString(),
        eventCount: 99,
      },
    ];

    const ctx: any = {
      agents: {
        create: async () => ({
          agent: { id: "s", session: { id: "s" } },
          dispose: async () => {},
        }),
      },
      sessionPersistence: {
        list: async (_cwd?: string) => sessions,
      },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    };

    const router = createRouter(mockBot, ctx);

    const result = await (router as any).listWorkspaceSessions(44444);

    assert.ok(result.text.includes("telegram-44444-ok"), "Should show matching session");
    assert.ok(!result.text.includes("99999"), "Should NOT show session from other workspace");
  }

  // --- Test 5: limit 10 + "и ещё N" ---
  {
    setTestFile("t5.json");
    clearChatsFile();
    writeChatsFile(55555, "/tmp/ws5");

    const now = new Date();
    const manySessions = Array.from({ length: 15 }, (_, i) => ({
      sessionId: `telegram-55555-${String(i).padStart(4, "0")}`,
      cwd: "/tmp/ws5",
      createdAt: new Date(now.getTime() - i * 60000).toISOString(),
      eventCount: i + 1,
    }));

    const ctx: any = {
      agents: {
        create: async () => ({
          agent: { id: "s", session: { id: "s" } },
          dispose: async () => {},
        }),
      },
      sessionPersistence: {
        list: async (_cwd?: string) => manySessions,
      },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    };

    const router = createRouter(mockBot, ctx);

    const result = await (router as any).listWorkspaceSessions(55555);

    assert.ok(result.text.includes("и ещё 5"), `Expected "и ещё 5", got: ${result.text}`);
    assert.ok(result.text.includes("(15)"), `Expected total count (15), got: ${result.text}`);
  }

  // --- Test 7: runtime snapshot {header,...} maps to PersistedSession, filtered by cwd ---
  {
    setTestFile("t7.json");
    clearChatsFile();
    writeChatsFile(77777, "/tmp/ws7", "telegram-77777-active");

    const now = new Date();
    const runtimeSession = {
      header: { id: "telegram-77777-active", cwd: "/tmp/ws7", createdAt: now.toISOString() },
      sessionId: "telegram-77777-active",
      cwd: "/tmp/ws7",
      createdAt: now.toISOString(),
      eventCount: 7,
    };
    const runtimeOther = {
      header: { id: "telegram-88888-other", cwd: "/tmp/ws8", createdAt: now.toISOString() },
      sessionId: "telegram-88888-other",
      cwd: "/tmp/ws8",
      createdAt: now.toISOString(),
      eventCount: 3,
    };

    const ctx: any = {
      agents: {
        create: async () => ({
          agent: { id: "s", session: { id: "s" } },
          dispose: async () => {},
        }),
      },
      sessionPersistence: {
        list: async (_cwd?: string) => [runtimeSession, runtimeOther],
      },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    };

    const router = createRouter(mockBot, ctx);

    const result = await (router as any).listWorkspaceSessions(77777);

    assert.ok(result.text.includes("telegram-77777-active"), "Runtime header session should be listed");
    assert.ok(!result.text.includes("88888"), "Session from other workspace should be excluded");
    assert.ok(result.text.includes("7 events"), "Runtime header eventCount should be shown");
  }

  // --- Test 8: missing-persistence branch (sessionPersistence === undefined) does not crash ---
  {
    setTestFile("t8.json");
    clearChatsFile();
    writeChatsFile(88888, "/tmp/ws8", "telegram-88888-active");

    const ctx: any = {
      agents: {
        create: async () => ({
          agent: { id: "s", session: { id: "s" } },
          dispose: async () => {},
        }),
      },
      // sessionPersistence is intentionally absent
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    };

    const router = createRouter(mockBot, ctx);

    const result = await (router as any).listWorkspaceSessions(88888);

    // Should not throw; with no persistence → empty → "не найдено"
    assert.ok(typeof result.text === "string", "Should return a text string");
    assert.ok(result.text.includes("не найдено"), "Empty list should report not found");
  }

  // --- Test 6: /list via routeMessage does not create agent ---
  {
    setTestFile("t6.json");
    clearChatsFile();
    writeChatsFile(66666, "/tmp/ws6");

    const messages: Array<{ chatId: number; text: string }> = [];
    const mockBot6 = {
      sendText: async (chatId: number | string, text: string) => {
        messages.push({ chatId: Number(chatId), text });
      },
    };

    const ctx: any = {
      agents: {
        created: [] as any[],
        create: async () => ({
          agent: { id: "s", session: { id: "s" } },
          dispose: async () => {},
        }),
      },
      sessionPersistence: {
        list: async (_cwd?: string) => [],
      },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    };

    const router = createRouter(mockBot6, ctx);

    await router.routeMessage(66666, { text: "/list" });

    assert.strictEqual(messages.length, 1, "Should send one message");
    assert.strictEqual(ctx.agents.created.length, 0, "No agent should be created by /list");
    assert.ok(messages[0].text.includes("не найдено"), "Should show empty message");
  }
});

afterEach(() => {
  clearChatsFile();
  cleanupDir();
});
