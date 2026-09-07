/**
 * Vocabulary for the vision capability seam (`ctx.vision`). One capability kind
 * (`view`) owns provider selection, cancellation, and errors so the model-facing
 * tool never binds to a vendor endpoint or key.
 * @module @deepseek-ai/dsh-vision/types
 */
import { HarnessError } from '@deepseek-ai/dsh-llm';
/**
 * Typed vision error with a machine-routable, open-string `code` and chained `cause`.
 * Shared codes cover unavailable, missing, unusable, ambiguous, or duplicate
 * providers, missing credentials, cancellation, and provider failure. Tool
 * execution exposes the code in structured error metadata.
 */
export class VisionError extends HarnessError {
}
//# sourceMappingURL=types.js.map