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
    index: number;
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
export declare function getWorkspaceRegistry(ctx: {
    get?(key: string): unknown;
    workspaceRegistry?: unknown;
}): WorkspaceRegistry | undefined;
/**
 * List all workspaces from the registry. Returns an empty array when the
 * registry is unavailable or returns no workspaces.
 */
export declare function listWorkspaces(ctx: {
    get?(key: string): unknown;
    workspaceRegistry?: unknown;
}): WorkspaceSummary[];
/**
 * Resolve a workspace from a list of summaries using the user's selector.
 *
 * - Numeric string (e.g. "2") → element by index (1-based).
 * - Path string → workspace whose path matches and exists on disk.
 * - Anything else → throws Error.
 */
export declare function resolveWorkspace(ctx: {
    get?(key: string): unknown;
    workspaceRegistry?: unknown;
}, selector: string): WorkspaceSummary;
/**
 * Find a workspace entry in the registry by its absolute path.
 * Returns undefined when the registry is unavailable or no match exists.
 */
export declare function findWorkspaceByPath(ctx: {
    get?(key: string): unknown;
    workspaceRegistry?: unknown;
}, targetPath: string): Workspace | undefined;
//# sourceMappingURL=workspaces.d.ts.map