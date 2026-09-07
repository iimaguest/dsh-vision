/**
 * Vocabulary for the vision capability seam (`ctx.vision`). One capability kind
 * (`view`) owns provider selection, cancellation, and errors so the model-facing
 * tool never binds to a vendor endpoint or key.
 * @module @deepseek-ai/dsh-vision/types
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * What one view-capable backend is asked to inspect. The request carries a
 * durable normalized attachment and the prompt the consumer resolved; pixel and
 * token budgets stay on the provider.
 */
export interface VisionViewRequest {
  /** Durable normalized attachment committed before the provider is called. */
  readonly attachment: ImageAttachmentRef
  /** Inspection prompt; the consumer supplies a default when the model omitted one. */
  readonly prompt: string
}

/**
 * Normalized view outcome. `text` is the only model-facing payload; `provider`
 * and `model` identify the auxiliary route that produced it.
 */
export interface VisionViewResult {
  /** Assistant text returned by the auxiliary vision model. */
  readonly text: string
  /** Registry id of the provider that served the view. */
  readonly provider: string
  /** Wire model id the provider sent. */
  readonly model: string
}

/**
 * A view-capable backend. Registered with `ctx.vision.registerViewProvider`.
 * `id` is a stable string, unique within the view capability kind.
 */
export interface VisionViewProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /** Inspect one attachment; honor `signal` for cancellation. */
  view(request: VisionViewRequest, signal?: AbortSignal): Promise<VisionViewResult>
}

/**
 * Typed vision error with a machine-routable, open-string `code` and chained `cause`.
 * Shared codes cover unavailable, missing, unusable, ambiguous, or duplicate
 * providers, missing credentials, cancellation, and provider failure. Tool
 * execution exposes the code in structured error metadata.
 */
export class VisionError extends HarnessError {}
