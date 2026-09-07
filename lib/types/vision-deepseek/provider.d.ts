/**
 * DeepSeek vision through a non-streaming OpenAI-compatible chat-completions
 * call with one inline `image_url`. The wire format and native `fetch` client
 * are provider-private and do not use `ctx.llm`.
 * @module @deepseek-ai/dsh-vision-deepseek/provider
 */
import type { AttachmentStore, RequestImageAttachment } from '@deepseek-ai/dsh-attachment';
import type { CredentialRef } from '@deepseek-ai/dsh-credentials';
import type { VisionViewProvider, VisionViewRequest, VisionViewResult } from '../index.js';
import type { ChatCompletionResponse } from './types.js';
/** Stable id this provider registers under. */
export declare const DEEPSEEK_PROVIDER_ID = "deepseek-official";
/**
 * Default chat-completions base (`/chat/completions` is appended). This is the
 * same origin `@deepseek-ai/dsh-llm-deepseek` uses, so this provider honors
 * `$DEEPSEEK_BASE_URL` and does not honor `$DEEPSEEK_SEARCH_BASE_URL`.
 */
export declare const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";
/** Default OpenAI-format vision model name. */
export declare const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash-vision-exp";
/** Default upper bound on generated tokens for the chat-completions request. */
export declare const DEEPSEEK_DEFAULT_MAX_TOKENS = 4096;
/** Total-pixel budget matching DeepSeek's ordinary vision projection. */
export declare const DEEPSEEK_DEFAULT_IMAGE_PIXEL_BUDGET = 640000;
/** Encoded-byte cap for one deterministic request version. */
export declare const DEEPSEEK_DEFAULT_IMAGE_MAX_BYTES: number;
/**
 * Exact secret-free DeepSeek chat-completions request recorded immediately
 * before one auxiliary view dispatch. The image payload is identified by the
 * attachment and request-version metadata; bytes and bearer tokens stay off
 * the log.
 */
export interface DeepSeekViewLlmRequest {
    /** Fully resolved chat-completions endpoint. */
    readonly endpoint: string;
    /** Wire model id. */
    readonly model: string;
    /** Output-token cap sent as `max_tokens`. */
    readonly max_tokens: number;
    /** Inspection prompt sent as the user text part. */
    readonly prompt: string;
    /** Durable attachment id the request version was derived from. */
    readonly attachmentId: string;
    /** Request-version media type actually sent. */
    readonly mediaType: RequestImageAttachment['mediaType'];
    /** Request-version width in pixels. */
    readonly width: number;
    /** Request-version height in pixels. */
    readonly height: number;
    /** Request-version encoded byte length. */
    readonly bytes: number;
}
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /** Secret-free auxiliary DeepSeek vision request recorded before dispatch. */
        'vision/deepseek-view-llm-request': DeepSeekViewLlmRequest;
    }
}
/** Resolved provider options (the plugin's `apply` supplies credential and constant defaults). */
export interface DeepSeekViewProviderOptions {
    /** Literal DeepSeek API key; when present it wins over {@link resolveApiKey}. */
    apiKey?: string;
    /** Resolve the current DeepSeek API key for one view operation. */
    resolveApiKey?: () => Promise<string | undefined>;
    /** Credential reference named by missing-credential diagnostics. */
    apiKeyEnv?: CredentialRef;
    /** Endpoint base; `/chat/completions` is appended. */
    baseURL: string;
    /** OpenAI-format model name. */
    model: string;
    /** Upper bound on generated tokens for the chat-completions request. */
    maxTokens: number;
    /** Total-pixel budget for `readImageRequest`. */
    imagePixelBudget: number;
    /** Encoded-byte cap for `readImageRequest`. */
    imageMaxBytes: number;
    /** Resolve the current durable attachment store; absence rejects the view. */
    resolveAttachments: () => AttachmentStore | undefined;
    /**
     * Record the exact secret-free request immediately before dispatch. A throw
     * prevents dispatch so model-visible auxiliary input cannot escape logging.
     */
    recordRequest?: (request: DeepSeekViewLlmRequest) => void;
}
/** The DeepSeek-backed view provider; HTTP redirects fail as `VISION_PROVIDER_ERROR`. */
export declare class DeepSeekViewProvider implements VisionViewProvider {
    private readonly resolveOptions;
    readonly id = "deepseek-official";
    /**
     * @param resolveOptions - the options for the NEXT operation, snapshotted
     * once at each operation's entry so one view never mixes two sections. A
     * thunk rather than a value because the plugin's settings section can change
     * between views, and re-registering the provider to carry a new endpoint
     * would make the seam's selection observable to the user as a flicker.
     */
    constructor(resolveOptions: () => DeepSeekViewProviderOptions);
    available(): boolean;
    view(request: VisionViewRequest, signal?: AbortSignal): Promise<VisionViewResult>;
    /**
     * Derive one request version through the attachment store. Cancellation and
     * store failures stay distinguishable from a missing credential.
     * @param attachments - the store that owns `readImageRequest`.
     * @param attachment - the durable normalized attachment.
     * @param options - the caller's snapshot, so the pixel/byte budgets come from one section.
     * @param signal - abort signal for the surrounding view.
     * @returns the route-sized request version.
     */
    private requestVersion;
    /**
     * Resolve one operation's credential without retaining it on the provider.
     * @param options - the caller's snapshot, so the key and the endpoint it is sent to come from one section.
     * @param signal - abort signal for the surrounding view.
     * @returns the resolved key.
     */
    private apiKey;
}
/**
 * Map a DeepSeek chat-completions response to a normalized view result.
 * Only assistant text is accepted; a missing or empty body is an error.
 * @param response - the parsed chat-completions response body.
 * @param model - the wire model id sent on this request.
 * @returns the normalized result.
 * @throws {@link VisionError} when the response carries no assistant text.
 */
export declare function mapChatCompletionResponse(response: ChatCompletionResponse, model: string): VisionViewResult;
//# sourceMappingURL=provider.d.ts.map