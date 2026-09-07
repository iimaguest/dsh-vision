/**
 * Derive the working directory a vision tool resolves relative paths against:
 * the calling agent's per-session workspace. Non-agent calls return
 * `undefined`, leaving the fallback in the filesystem provider.
 * @module @deepseek-ai/dsh-tool-vision/session-cwd
 */
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
/**
 * The session workspace cwd for this call, or `undefined` when none applies.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @param requestedPath - the path the provider will resolve; parent traversal
 *   makes a symlinked cwd's filesystem identity observable.
 * @returns the calling agent's session cwd, or undefined for a non-agent caller.
 */
export declare function sessionCwd(exec: ToolExecution, requestedPath: string): string | undefined;
/**
 * Resolution options shared by the vision filesystem admission path.
 * @param exec - the tool-execution context supplying session cwd and cancellation.
 * @param requestedPath - the path the provider will resolve.
 * @returns provider resolution options for the current tool call.
 */
export declare function sessionResolveOptions(exec: ToolExecution, requestedPath: string): {
    cwd?: string;
    signal?: AbortSignal;
};
//# sourceMappingURL=session-cwd.d.ts.map