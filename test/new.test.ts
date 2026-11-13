import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "../src/server/router.ts";
import { setChatsFile, loadChatState, getChatsFilePath } from "../src/server/state.ts";
import { existsSync, writeFileSync, unlinkSync, mkdirSync, readdirSync, rmdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

// ── Helpers ─────────────────────────────────────────────────────────────

const TEST_DIR = "/tmp/dsh-telegram-new-test-" + process.pid;

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
  const dir = dirname(file);
  try {
    for (const f of readdirSync(dir)) {
      if (f.startsWith("telegram-chats") || f.endsWith(".tmp." + process.pid)) {
        try { unlinkSync(join(dir, f)); } catch {}
      }
    }
  } catch {}
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeChatsFile(chatId: number, workspacePath: string): void {
  ensureTestDir();
  const file = getChatsFilePath();
  const store = {
    chats: {
      [String(chatId)]: {
        chatId,
        workspacePath,
        updatedAt: new Date().toISOString(),
      },
    },
  };
  writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
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

function makeFakeCtxWithWorkspace(
  workspacePath: string,
  workspaceTitle: string,
  attachedSessionIds: string[] = [],
) {
  const createdSessions: Array<{ sessionId: string; meta?: { cwd?: string } }> = [];
  const wsRegistry = {
    list: () => [
      {
        id: "ws-test",
        path: workspacePath,
        title: workspaceTitle,
        sessionIds: attachedSessionIds,
        attachSession: (sessionId: string) => {
          attachedSessionIds.push(sessionId);
        },
      },
    ],
  };

  return {
    agents: {
      created: createdSessions,
      create: async (opts: any) => {
        createdSessions.push({ sessionId: opts.sessionId, meta: opts.meta });
        const sid = opts.sessionId;
        return {
          agent: { id: sid, session: { id: sid } },
          dispose: async () => {},
        };
      },
    },
    workspaceRegistry: wsRegistry,
    get: (key: string) => {
      if (key === "workspaceRegistry") return wsRegistry;
      return undefined;
    },
    logger: {
      info: () => {},
      error: () => {},
    },
  };
}

function makeEmptyCtx() {
  return {
    agents: {
      created: [] as any[],
      create: async (_opts: any) => {
        const sid = _opts.sessionId;
        return {
          agent: { id: sid, session: { id: sid } },
          dispose: async () => {},
        };
      },
    },
    workspaceRegistry: undefined,
    get: () => undefined,
    logger: {
      info: () => {},
      error: () => {},
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

test("/new without workspace → error message, agent not created", async () => {
  const mockBot = { sendText: async (_chatId: number | string, _text: string) => {} };
  const ctx = makeEmptyCtx();
  setTestFile("t1.json");
  clearChatsFile();

  // Ensure no workspace is selected
  const stateBefore = loadChatState(999);
  assert.strictEqual(stateBefore.workspacePath, undefined);

  const router = createRouter(mockBot, ctx as any);

  // /new without workspace should return error
  const result = await (router as any).createNewSession(999);
  assert.ok(result.text.includes("⚠️"), `Expected error with ⚠️, got: ${result.text}`);
  assert.ok(result.text.includes("/ws"), `Expected mention of /ws, got: ${result.text}`);

  // Agent should NOT have been created
  assert.strictEqual(ctx.agents.created.length, 0);
});

test("/new with workspace → creates agent with meta.cwd === workspace.path, attachSession called", async () => {
  const mockBot = { sendText: async (_chatId: number | string, _text: string) => {} };
  const attachedIds: string[] = [];
  const wsPath = "/tmp/test-workspace-for-new";
  const ctx = makeFakeCtxWithWorkspace(wsPath, "TestProject", attachedIds);

  // Set up state file with workspace selected — write directly to avoid debounce issues
  setTestFile("t2.json");
  clearChatsFile();
  writeChatsFile(888, wsPath);

  const router = createRouter(mockBot, ctx as any);

  // Verify state has workspace from file
  const stateAfter = loadChatState(888);
  assert.strictEqual(stateAfter.workspacePath, wsPath);

  // Now create new session
  const result = await (router as any).createNewSession(888);

  // Should return success message with correct format
  assert.ok(result.text.startsWith("🆕 Сессия"), `Expected 🆕 prefix, got: ${result.text}`);
  assert.ok(result.text.includes("TestProject"), `Expected workspace title in reply, got: ${result.text}`);
  assert.ok(result.text.includes(wsPath), `Expected workspace path in reply, got: ${result.text}`);

  // Agent should have been created with correct cwd
  assert.strictEqual(ctx.agents.created.length, 1);
  assert.strictEqual(
    ctx.agents.created[0].meta?.cwd,
    wsPath,
    "create must receive meta.cwd === workspace.path",
  );

  // attachSession should be called with the new session id
  assert.ok(attachedIds.length > 0, "attachSession should have been called");
  const createdSid = ctx.agents.created[0].sessionId;
  assert.ok(
    attachedIds.includes(createdSid),
    `attachSession should have been called with ${createdSid}`,
  );

  // sessionId should be persisted in state (debounce + flush)
  await wait(600);
  const finalState = loadChatState(888);
  assert.ok(finalState.sessionId, "sessionId should be saved to chat state");
});

test("/new without workspace → agent.create is NOT called", async () => {
  let createCalled = false;
  const ctx = {
    agents: {
      create: async () => {
        createCalled = true;
        return {
          agent: { id: "should-not-happen", session: { id: "should-not-happen" } },
          dispose: async () => {},
        };
      },
    },
    workspaceRegistry: undefined,
    get: () => undefined,
    logger: { info: () => {}, error: () => {} },
  };

  const mockBot = { sendText: async () => {} };
  setTestFile("t3.json");
  clearChatsFile();

  const router = createRouter(mockBot, ctx as any);
  const result = await (router as any).createNewSession(777);

  assert.ok(result.text.includes("⚠️"));
  assert.strictEqual(createCalled, false, "agents.create must NOT be called when no workspace");
});

test("/new with workspace → sessionId saved to state", async () => {
  const mockBot = { sendText: async (_chatId: number | string, _text: string) => {} };
  const wsPath = "/tmp/test-workspace-session-id";
  const ctx = makeFakeCtxWithWorkspace(wsPath, "SessionIdTest");

  setTestFile("t4.json");
  clearChatsFile();
  writeChatsFile(100, wsPath);

  const router = createRouter(mockBot, ctx as any);
  await (router as any).createNewSession(100);

  // Wait for debounce flush
  await wait(600);
  const finalState = loadChatState(100);
  assert.ok(finalState.sessionId, "sessionId should be persisted");
  assert.ok(finalState.sessionId!.startsWith("telegram-"), "sessionId should have telegram- prefix");
});

afterEach(() => {
  clearChatsFile();
  cleanupDir();
});
