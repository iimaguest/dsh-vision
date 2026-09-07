/**
 * Model-facing `view_image` tool over `ctx.vision`. This package owns schema,
 * prompt guidance, filesystem admission, and presentation, never a concrete
 * provider. Registration is enablement-based: the tool stays visible when its
 * provider is unavailable and fails with a structured error at execution time.
 * @module @deepseek-ai/dsh-tool-vision
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export { DEFAULT_VIEW_PROMPT, applyViewImageTool, formatViewOutput, imageMediaTypeForPath, presentViewCall, resolveViewPrompt, } from './view.ts';
export type { ImageViewArgs, ImageViewValue } from './view.ts';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "tool-vision";
/** Services required by the vision tool. */
export declare const inject: string[];
/** Default cooperative tool-call timeout budget (ms) for `view_image`. */
export declare const DEFAULT_VISION_TOOL_TIMEOUT_MS = 60000;
/** Plugin config: the cooperative timeout budget. */
export interface Config {
    /** Cooperative timeout budget (ms) for `view_image`. Defaults to 60000. */
    timeoutMs?: number;
}
export declare const Config: z<Config>;
/**
 * Register `view_image` while a durable attachment store is mounted. Without
 * a store there is no honest request version and no reconstructable auxiliary
 * input. The tool's disposer is fiber-scoped.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map