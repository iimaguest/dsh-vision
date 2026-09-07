/**
 * The model-facing `view_image` tool: send one local image to a configured
 * auxiliary vision route and return text. Execution goes through `ctx.vision`
 * — this module owns only the model-facing schema, filesystem admission,
 * `saveImage`, result formatting, and presentation, never provider selection
 * or network access.
 * @module @deepseek-ai/dsh-tool-vision/view
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment';
import type { GenericCallView } from '@deepseek-ai/dsh-tools';
/**
 * Default inspection prompt when the model omits `question`. Provider-neutral:
 * describe the image for a coding assistant, transcribe visible text, and name
 * layout, errors, and coordinates when they matter.
 */
export declare const DEFAULT_VIEW_PROMPT = "Describe this image for a coding assistant. Transcribe visible text. Name layout, errors, and coordinates when they matter.";
/** Model-facing `view_image` arguments. */
export interface ImageViewArgs {
    file_path: string;
    question?: string;
}
/** The structured outcome declared by the `view_image` output schema. */
export interface ImageViewValue {
    path: string;
    text: string;
    provider: string;
    model: string;
    image: {
        attachmentId: string;
        mediaType: ImageMediaType;
        bytes: number;
        width: number;
        height: number;
        name?: string;
        /** Orientation-applied file dimensions before normalization; present only when storage reduced it. */
        originalDimensions?: {
            width: number;
            height: number;
        };
    };
    /** Opaque observed-state carrier: never rendered, re-projected into `meta.fsObserved`. */
    targetKey: string;
    /** Opaque observed version (the read's stat version), re-projected into `meta.fsObserved`. */
    version: string;
}
/**
 * Map a model-supplied path to its declared image media type by extension.
 * @param filePath - the raw `file_path` argument (not yet resolved).
 * @returns the declared media type, or undefined when the path does not claim an image.
 */
export declare function imageMediaTypeForPath(filePath: string): ImageMediaType | undefined;
/**
 * Resolve the inspection prompt the auxiliary model sees. A blank `question`
 * is treated as omitted so the tool never sends whitespace-only text.
 * @param question - the optional model-supplied question.
 * @returns the non-empty prompt.
 */
export declare function resolveViewPrompt(question: string | undefined): string;
/**
 * Format a view result as the model-facing text. The conversation model must
 * never receive an image block from this tool.
 * @param value - the structured view outcome.
 * @returns the resolved path, auxiliary route, and description.
 */
export declare function formatViewOutput(value: ImageViewValue): string;
/**
 * Pending-call presentation: a generic read card with a follow-along location.
 * @param args - the raw tool arguments; only the path feeds the view.
 * @returns the generic card view (`kind: 'read'`) shown while the call runs.
 */
export declare function presentViewCall(args: ImageViewArgs): GenericCallView;
/**
 * Register the `view_image` tool and its system-prompt guidance.
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the
 *   registrations; both are effect-scoped and unregister on plugin dispose.
 * @param timeoutMs - the cooperative tool-call budget (ms) attached as the
 *   tool's `ToolDefinition.timeoutMs`.
 */
export declare function applyViewImageTool(ctx: Context, timeoutMs: number): void;
//# sourceMappingURL=view.d.ts.map