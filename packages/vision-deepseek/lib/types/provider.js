/**
 * DeepSeek vision through a non-streaming OpenAI-compatible chat-completions
 * call with one inline `image_url`. The wire format and native `fetch` client
 * are provider-private and do not use `ctx.llm`.
 * @module @deepseek-ai/dsh-vision-deepseek/provider
 */
import { VisionError } from '@deepseek-ai/dsh-vision';
/** Stable id this provider registers under. */
export const DEEPSEEK_PROVIDER_ID = 'deepseek-official';
/**
 * Default chat-completions base (`/chat/completions` is appended). This is the
 * same origin `@deepseek-ai/dsh-llm-deepseek` uses, so this provider honors
 * `$DEEPSEEK_BASE_URL` and does not honor `$DEEPSEEK_SEARCH_BASE_URL`.
 */
export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com';
/** Default OpenAI-format vision model name. */
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash-vision-exp';
/** Default upper bound on generated tokens for the chat-completions request. */
export const DEEPSEEK_DEFAULT_MAX_TOKENS = 4096;
/** Total-pixel budget matching DeepSeek's ordinary vision projection. */
export const DEEPSEEK_DEFAULT_IMAGE_PIXEL_BUDGET = 640_000;
/** Encoded-byte cap for one deterministic request version. */
export const DEEPSEEK_DEFAULT_IMAGE_MAX_BYTES = 1024 * 1024;
/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1';
/** The DeepSeek-backed view provider; HTTP redirects fail as `VISION_PROVIDER_ERROR`. */
export class DeepSeekViewProvider {
    resolveOptions;
    id = DEEPSEEK_PROVIDER_ID;
    /**
     * @param resolveOptions - the options for the NEXT operation, snapshotted
     * once at each operation's entry so one view never mixes two sections. A
     * thunk rather than a value because the plugin's settings section can change
     * between views, and re-registering the provider to carry a new endpoint
     * would make the seam's selection observable to the user as a flicker.
     */
    constructor(resolveOptions) {
        this.resolveOptions = resolveOptions;
    }
    available() {
        const options = this.resolveOptions();
        return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
            && URL.canParse(options.baseURL)
            && options.model.trim().length > 0
            && isPositiveInteger(options.maxTokens)
            && isPositiveInteger(options.imagePixelBudget)
            && isPositiveInteger(options.imageMaxBytes);
    }
    async view(request, signal) {
        // One snapshot for the whole operation: credential resolution and image
        // projection await, and a settings write landing inside those awaits must
        // not send the key resolved from the old section to the endpoint named by
        // the new one.
        const options = this.resolveOptions();
        const apiKey = await this.apiKey(options, signal);
        throwIfViewAborted(signal);
        const attachments = options.resolveAttachments();
        if (attachments === undefined) {
            throw new VisionError('DeepSeek vision has no attachment service mounted; a durable store is required to derive a request version', 'VISION_PROVIDER_ERROR');
        }
        const version = await this.requestVersion(attachments, request.attachment, options, signal);
        throwIfViewAborted(signal);
        const endpoint = `${options.baseURL}/chat/completions`;
        const body = {
            model: options.model,
            max_tokens: options.maxTokens,
            stream: false,
            thinking: { type: 'disabled' },
            messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: request.prompt },
                        {
                            type: 'image_url',
                            image_url: { url: `data:${version.mediaType};base64,${Buffer.from(version.data).toString('base64')}` },
                        },
                    ],
                }],
        };
        options.recordRequest?.({
            endpoint,
            model: options.model,
            max_tokens: options.maxTokens,
            prompt: request.prompt,
            attachmentId: request.attachment.attachmentId,
            mediaType: version.mediaType,
            width: version.width,
            height: version.height,
            bytes: version.bytes,
        });
        throwIfViewAborted(signal);
        let response;
        try {
            response = await fetch(endpoint, {
                method: 'POST',
                redirect: 'error',
                headers: {
                    'authorization': `Bearer ${apiKey}`,
                    'content-type': 'application/json',
                    'accept': 'application/json',
                    'user-agent': USER_AGENT,
                },
                body: JSON.stringify(body),
                ...signal !== undefined ? { signal } : {},
            });
        }
        catch (error) {
            if (signal?.aborted === true || isAbortError(error))
                throw viewAborted(signal, error);
            throw new VisionError(`DeepSeek vision request failed: ${String(error)}`, 'VISION_PROVIDER_ERROR', { cause: error });
        }
        if (!response.ok) {
            const status = response.status;
            let message = `DeepSeek API error (HTTP ${status})`;
            try {
                const parsed = await response.json();
                const detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message;
                if (detail !== undefined && detail.length > 0)
                    message = detail;
            }
            catch (error) {
                // An abort fired mid-body must surface as VISION_ABORTED, not be
                // swallowed into a generic HTTP-error message — cancellation is not a
                // provider error (the seam's cancellation contract).
                if (signal?.aborted === true || isAbortError(error))
                    throw viewAborted(signal, error);
                // Otherwise: the HTTP status is already captured in `message` above; a
                // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
                // cost a richer provider message, never the real error.
            }
            throw new VisionError(message, 'VISION_PROVIDER_ERROR');
        }
        try {
            const payload = await response.json();
            return mapChatCompletionResponse(payload, options.model);
        }
        catch (error) {
            if (signal?.aborted === true || isAbortError(error))
                throw viewAborted(signal, error);
            if (error instanceof VisionError)
                throw error;
            throw new VisionError(`DeepSeek returned an unprocessable response body: ${String(error)}`, 'VISION_PROVIDER_ERROR', { cause: error });
        }
    }
    /**
     * Derive one request version through the attachment store. Cancellation and
     * store failures stay distinguishable from a missing credential.
     * @param attachments - the store that owns `readImageRequest`.
     * @param attachment - the durable normalized attachment.
     * @param options - the caller's snapshot, so the pixel/byte budgets come from one section.
     * @param signal - abort signal for the surrounding view.
     * @returns the route-sized request version.
     */
    async requestVersion(attachments, attachment, options, signal) {
        throwIfViewAborted(signal);
        try {
            return await abortable(attachments.readImageRequest(attachment, {
                maxPixels: options.imagePixelBudget,
                maxBytes: options.imageMaxBytes,
            }, signal), signal);
        }
        catch (error) {
            if (signal?.aborted === true || isAbortError(error))
                throw viewAborted(signal, error);
            throw new VisionError(`DeepSeek vision request-image projection failed: ${String(error)}`, 'VISION_PROVIDER_ERROR', { cause: error });
        }
    }
    /**
     * Resolve one operation's credential without retaining it on the provider.
     * @param options - the caller's snapshot, so the key and the endpoint it is sent to come from one section.
     * @param signal - abort signal for the surrounding view.
     * @returns the resolved key.
     */
    async apiKey(options, signal) {
        throwIfViewAborted(signal);
        if (options.apiKey !== undefined && options.apiKey.length > 0)
            return options.apiKey;
        let resolved;
        try {
            resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal);
        }
        catch (error) {
            if (signal?.aborted === true || isAbortError(error))
                throw viewAborted(signal, error);
            throw new VisionError(`DeepSeek vision credential resolution failed: ${String(error)}`, 'VISION_PROVIDER_ERROR', { cause: error });
        }
        if (resolved !== undefined && resolved.length > 0)
            return resolved;
        const ref = options.apiKeyEnv ?? 'DEEPSEEK_API_KEY';
        throw new VisionError(`DeepSeek vision has no API key for "${ref}"; store it through the credentials service`
            + ' (the web Models page writes it), export it in the launching environment, or set a literal'
            + ' "apiKey" in the vision-deepseek config', 'VISION_PROVIDER_CREDENTIAL_MISSING');
    }
}
/**
 * Map a DeepSeek chat-completions response to a normalized view result.
 * Only assistant text is accepted; a missing or empty body is an error.
 * @param response - the parsed chat-completions response body.
 * @param model - the wire model id sent on this request.
 * @returns the normalized result.
 * @throws {@link VisionError} when the response carries no assistant text.
 */
export function mapChatCompletionResponse(response, model) {
    const text = response.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.length === 0) {
        throw new VisionError('DeepSeek returned no assistant text; the vision request produced an empty body', 'VISION_PROVIDER_ERROR');
    }
    return { text, provider: DEEPSEEK_PROVIDER_ID, model };
}
/**
 * Race a same-process asynchronous preflight against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become unhandled.
 */
function abortable(operation, signal) {
    if (signal === undefined)
        return operation;
    if (signal.aborted)
        return Promise.reject(viewAborted(signal));
    return new Promise((resolve, reject) => {
        const onAbort = () => { reject(viewAborted(signal)); };
        signal.addEventListener('abort', onAbort, { once: true });
        void operation.then((value) => {
            signal.removeEventListener('abort', onAbort);
            resolve(value);
        }, (error) => {
            signal.removeEventListener('abort', onAbort);
            reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }));
        });
    });
}
/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfViewAborted(signal) {
    if (signal?.aborted === true)
        throw viewAborted(signal);
}
/** Build the provider's stable cancellation error while retaining the caller's reason. */
function viewAborted(signal, fallback) {
    return new VisionError('DeepSeek vision aborted', 'VISION_ABORTED', {
        cause: signal?.aborted === true ? signal.reason : fallback,
    });
}
/** True for a fetch/`AbortSignal` abort, surfaced as `VISION_ABORTED`. */
function isAbortError(error) {
    return error instanceof DOMException && error.name === 'AbortError';
}
/** True for DeepSeek request limits that can be sent to chat-completions. */
function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}
//# sourceMappingURL=provider.js.map