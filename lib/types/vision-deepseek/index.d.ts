/**
 * Register a DeepSeek-backed provider in `ctx.vision`. It calls the
 * OpenAI-compatible chat-completions API with one inline image. The provider
 * reuses `DEEPSEEK_API_KEY` and honors `$DEEPSEEK_BASE_URL`, because vision
 * and conversation share the chat-completions base.
 * @module @deepseek-ai/dsh-vision-deepseek
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings';
export { DeepSeekViewProvider, DEEPSEEK_DEFAULT_BASE_URL, DEEPSEEK_DEFAULT_IMAGE_MAX_BYTES, DEEPSEEK_DEFAULT_IMAGE_PIXEL_BUDGET, DEEPSEEK_DEFAULT_MAX_TOKENS, DEEPSEEK_DEFAULT_MODEL, DEEPSEEK_PROVIDER_ID, mapChatCompletionResponse, } from './provider.js';
export type { DeepSeekViewLlmRequest, DeepSeekViewProviderOptions } from './provider.js';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "vision-deepseek";
/** The vision seam this provider registers into. */
export declare const inject: string[];
/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
    /** Literal DeepSeek API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
    apiKey?: string;
    /** Credential reference resolved for each view; defaults to `DEEPSEEK_API_KEY`. */
    apiKeyEnv?: string;
    /** Chat-completions endpoint base; `/chat/completions` is appended. */
    baseURL?: string;
    /** OpenAI-format model name. Defaults to `deepseek-v4-flash-vision-exp`. */
    model?: string;
    /** Upper bound on generated tokens for the chat-completions request. Defaults to 4096. */
    maxTokens?: number;
    /** Total-pixel budget for `readImageRequest`. Defaults to 640000. */
    imagePixelBudget?: number;
    /** Encoded-byte cap for `readImageRequest`. Defaults to 1048576. */
    imageMaxBytes?: number;
}
export declare const Config: z<Config>;
/** Settings namespace carrying this provider's endpoint, model, and key reference. */
export declare const VISION_DEEPSEEK_SETTINGS_NAMESPACE: SettingsNamespace;
/** Register the DeepSeek view provider with `ctx.vision`. */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map