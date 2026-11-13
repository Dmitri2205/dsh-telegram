import { test } from "node:test";
import assert from "node:assert/strict";
import { listWorkspaces, resolveWorkspace } from "../src/server/workspaces.js";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ── Helpers ─────────────────────────────────────────────────────────────

const TEST_DIR = "/tmp/dsh-telegram-ws-test-" + process.pid;

function ensureTestDir(): void {
  mkdirSync(TEST_DIR, { recursive: true });
}

function makeFakeCtx(workspaceList?: Array<{ id: string; path: string; title?: string; sessionIds: string[] }>) {
  const registry = workspaceList
    ? { list: () => workspaceList }
    : undefined;
  return {
    get: (key: string) => {
      if (key === "workspaceRegistry") return registry;
      return undefined;
    },
    workspaceRegistry: registry,
  };
}

function makeEmptyCtx() {
  return {
    get: () => undefined,
    workspaceRegistry: undefined,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

test("listWorkspaces returns empty when registry is unavailable", () => {
  const ctx = makeEmptyCtx();
  const result = listWorkspaces(ctx);
  assert.deepStrictEqual(result, []);
});

test("listWorkspaces returns empty when registry.list returns []", () => {
  const ctx = makeFakeCtx([]);
  const result = listWorkspaces(ctx);
  assert.deepStrictEqual(result, []);
});

test("listWorkspaces maps workspace entries correctly", () => {
  const wsList = [
    { id: "ws-1", path: "/home/user/project-a", title: "Project A", sessionIds: ["s1", "s2"] },
    { id: "ws-2", path: "/home/user/project-b", title: "Project B", sessionIds: [] },
  ];
  const ctx = makeFakeCtx(wsList);
  const result = listWorkspaces(ctx);

  assert.strictEqual(result.length, 2);
  assert.deepStrictEqual(result[0], { index: 1, id: "ws-1", path: "/home/user/project-a", title: "Project A", sessionCount: 2 });
  assert.deepStrictEqual(result[1], { index: 2, id: "ws-2", path: "/home/user/project-b", title: "Project B", sessionCount: 0 });
});

test("listWorkspaces uses path as fallback title", () => {
  const wsList = [{ id: "ws-3", path: "/tmp/no-title-ws", title: undefined, sessionIds: [] }];
  const ctx = makeFakeCtx(wsList);
  const result = listWorkspaces(ctx);

  assert.strictEqual(result[0].title, "/tmp/no-title-ws");
});

test("resolveWorkspace by number — valid index", () => {
  const wsList = [
    { id: "ws-1", path: "/tmp/ws1", title: "WS1", sessionIds: [] },
    { id: "ws-2", path: "/tmp/ws2", title: "WS2", sessionIds: [] },
  ];
  const ctx = makeFakeCtx(wsList);

  const result = resolveWorkspace(ctx, "1");
  assert.strictEqual(result.id, "ws-1");
  assert.strictEqual(result.path, "/tmp/ws1");
});

test("resolveWorkspace by number — out of range throws", () => {
  const wsList = [{ id: "ws-1", path: "/tmp/ws1", title: "WS1", sessionIds: [] }];
  const ctx = makeFakeCtx(wsList);

  assert.throws(() => resolveWorkspace(ctx, "2"), /Нет такого воркспейса/);
});

test("resolveWorkspace by number — zero throws", () => {
  const wsList = [{ id: "ws-1", path: "/tmp/ws1", title: "WS1", sessionIds: [] }];
  const ctx = makeFakeCtx(wsList);

  assert.throws(() => resolveWorkspace(ctx, "0"), /Нет такого воркспейса/);
});

test("resolveWorkspace by number — negative throws", () => {
  const wsList = [{ id: "ws-1", path: "/tmp/ws1", title: "WS1", sessionIds: [] }];
  const ctx = makeFakeCtx(wsList);

  assert.throws(() => resolveWorkspace(ctx, "-1"), /Нет такого воркспейса/);
});

test("resolveWorkspace by path — existing and in registry", () => {
  ensureTestDir();
  mkdirSync(join(TEST_DIR, "valid-ws"), { recursive: true });

  const wsList = [
    { id: "ws-1", path: join(TEST_DIR, "valid-ws"), title: "ValidWS", sessionIds: [] },
  ];
  const ctx = makeFakeCtx(wsList);

  const result = resolveWorkspace(ctx, join(TEST_DIR, "valid-ws"));
  assert.strictEqual(result.id, "ws-1");
});

test("resolveWorkspace by path — not in registry throws", () => {
  ensureTestDir();
  mkdirSync(join(TEST_DIR, "not-in-reg"), { recursive: true });

  const wsList = [{ id: "ws-1", path: "/tmp/ws1", title: "WS1", sessionIds: [] }];
  const ctx = makeFakeCtx(wsList);

  assert.throws(() => resolveWorkspace(ctx, join(TEST_DIR, "not-in-reg")), /Нет такого воркспейса/);
});

test("resolveWorkspace by path — directory does not exist throws", () => {
  const wsList = [{ id: "ws-1", path: "/tmp/ws1", title: "WS1", sessionIds: [] }];
  const ctx = makeFakeCtx(wsList);

  assert.throws(() => resolveWorkspace(ctx, "/nonexistent/path/abc"), /Нет такого воркспейса/);
});

test("resolveWorkspace by path — is a file not directory throws", () => {
  ensureTestDir();
  const tmpFile = join(TEST_DIR, "a-file.txt");
  writeFileSync(tmpFile, "data");

  const wsList = [{ id: "ws-1", path: "/tmp/ws1", title: "WS1", sessionIds: [] }];
  const ctx = makeFakeCtx(wsList);

  assert.throws(() => resolveWorkspace(ctx, tmpFile), /Нет такого воркспейса/);
});

test("resolveWorkspace by float string — not integer, tries path, fails", () => {
  const wsList = [{ id: "ws-1", path: "/tmp/ws1", title: "WS1", sessionIds: [] }];
  const ctx = makeFakeCtx(wsList);

  // "1.5" → not integer → falls through to path check → /nonexistent → throws
  assert.throws(() => resolveWorkspace(ctx, "1.5"), /Нет такого воркспейса/);
});

test("resolveWorkspace with unknown string — tries numeric (fails), then path (fails)", () => {
  const wsList = [{ id: "ws-1", path: "/tmp/ws1", title: "WS1", sessionIds: [] }];
  const ctx = makeFakeCtx(wsList);

  assert.throws(() => resolveWorkspace(ctx, "unknown"), /Нет такого воркспейса/);
});

test("listWorkspaces works via direct workspaceRegistry property", () => {
  const wsList = [{ id: "ws-direct", path: "/tmp/direct-ws", title: "Direct", sessionIds: ["x1"] }];
  const ctx = {
    get: undefined,
    workspaceRegistry: { list: () => wsList },
  };

  const result = listWorkspaces(ctx);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].title, "Direct");
});

// Cleanup handled by OS (unique /tmp dir per test run)
