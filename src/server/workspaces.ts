import { existsSync, statSync } from "node:fs";

/** Minimal shape of a Workspace returned by the registry. */
export interface Workspace {
  id: string;
  path: string;
  title?: string;
  sessionIds: string[];
}

/** Workspace with attachSession capability (for UI tree integration). */
export interface WorkspaceWithAttach extends Workspace {
  attachSession(sessionId: string): void;
}

/** A workspace entry as shown to the user in /ws output. */
export interface WorkspaceSummary {
  index: number;       // 1-based stable position
  id: string;
  path: string;
  title: string;
  sessionCount: number;
}

/** Shape of ctx.workspaceRegistry from DSH core. */
export interface WorkspaceRegistry {
  list(): Workspace[];
}

/**
 * Resolve the workspace registry from a context object.
 * Tries both `ctx.get("workspaceRegistry")` and direct `ctx.workspaceRegistry`.
 * Returns undefined when the profile does not include workspace support.
 */
export function getWorkspaceRegistry(
  ctx: { get?(key: string): unknown; workspaceRegistry?: unknown },
): WorkspaceRegistry | undefined {
  // Try ctx.get() first (cordis context pattern)
  if (ctx && typeof ctx.get === "function") {
    const raw = ctx.get("workspaceRegistry");
    if (raw && typeof raw === "object" && "list" in raw) {
      return raw as WorkspaceRegistry;
    }
  }
  // Fall back to direct property
  const direct = ctx.workspaceRegistry;
  if (direct && typeof direct === "object" && "list" in direct) {
    return direct as WorkspaceRegistry;
  }
  return undefined;
}

/**
 * List all workspaces from the registry. Returns an empty array when the
 * registry is unavailable or returns no workspaces.
 */
export function listWorkspaces(
  ctx: { get?(key: string): unknown; workspaceRegistry?: unknown },
): WorkspaceSummary[] {
  const reg = getWorkspaceRegistry(ctx);
  if (!reg) return [];

  const entries = reg.list();
  return entries.map((ws, i) => ({
    index: i + 1,
    id: ws.id,
    path: ws.path,
    title: ws.title || ws.path,
    sessionCount: Array.isArray(ws.sessionIds) ? ws.sessionIds.length : 0,
  }));
}

/**
 * Resolve a workspace from a list of summaries using the user's selector.
 *
 * - Numeric string (e.g. "2") → element by index (1-based).
 * - Path string → workspace whose path matches and exists on disk.
 * - Anything else → throws Error.
 */
export function resolveWorkspace(
  ctx: { get?(key: string): unknown; workspaceRegistry?: unknown },
  selector: string,
): WorkspaceSummary {
  const list = listWorkspaces(ctx);

  // Try numeric (1-based) index first
  const num = Number(selector);
  if (!Number.isNaN(num) && num > 0 && Number.isInteger(num)) {
    const found = list.find((ws) => ws.index === num);
    if (found) return found;
    throw new Error("Нет такого воркспейса");
  }

  // Try path match
  if (!existsSync(selector)) {
    throw new Error("Нет такого воркспейса");
  }
  const st = statSync(selector);
  if (!st.isDirectory()) {
    throw new Error("Нет такого воркспейса");
  }

  const found = list.find((ws) => ws.path === selector);
  if (found) return found;

  throw new Error("Нет такого воркспейса");
}

/**
 * Find a workspace entry in the registry by its absolute path.
 * Returns undefined when the registry is unavailable or no match exists.
 */
export function findWorkspaceByPath(
  ctx: { get?(key: string): unknown; workspaceRegistry?: unknown },
  targetPath: string,
): Workspace | undefined {
  const reg = getWorkspaceRegistry(ctx);
  if (!reg) return undefined;
  return reg.list().find((ws) => ws.path === targetPath);
}
