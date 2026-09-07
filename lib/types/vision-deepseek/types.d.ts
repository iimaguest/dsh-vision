/**
 * Provider-private wire types for DeepSeek's OpenAI-compatible chat-completions
 * API. These types do not create a dependency on `ctx.llm`.
 * @module @deepseek-ai/dsh-vision-deepseek/types
 */
/** Assistant message inside a non-streaming chat-completions response. */
export interface ChatCompletionMessage {
    role?: string;
    content?: string | null;
}
/** One choice in a non-streaming chat-completions response. */
export interface ChatCompletionChoice {
    message?: ChatCompletionMessage;
}
/** DeepSeek chat-completions response envelope. */
export interface ChatCompletionResponse {
    choices?: ChatCompletionChoice[];
}
/** DeepSeek's error response envelope (best-effort; fields vary). */
export interface ChatCompletionError {
    error?: {
        message?: string;
    } | string;
    message?: string;
}
//# sourceMappingURL=types.d.ts.map