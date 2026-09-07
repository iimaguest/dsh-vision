/**
 * Model-facing `view_image` tool over `ctx.vision`. This package owns schema,
 * prompt guidance, filesystem admission, and presentation, never a concrete
 * provider. Registration is enablement-based: the tool stays visible when its
 * provider is unavailable and fails with a structured error at execution time.
 * @module @deepseek-ai/dsh-tool-vision
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-vision'
import { applyViewImageTool } from './view.ts'

export {
  DEFAULT_VIEW_PROMPT,
  applyViewImageTool,
  formatViewOutput,
  imageMediaTypeForPath,
  presentViewCall,
  resolveViewPrompt,
} from './view.ts'
export type { ImageViewArgs, ImageViewValue } from './view.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-vision'

/** Services required by the vision tool. */
export const inject = ['tools', 'vision', 'systemPrompt', 'fs']

/** Default cooperative tool-call timeout budget (ms) for `view_image`. */
export const DEFAULT_VISION_TOOL_TIMEOUT_MS = 60_000

/** Plugin config: the cooperative timeout budget. */
export interface Config {
  /** Cooperative timeout budget (ms) for `view_image`. Defaults to 60000. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  timeoutMs: z.number().default(DEFAULT_VISION_TOOL_TIMEOUT_MS),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/** Configured timeout must be a positive integer. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-vision: ${name} must be a positive integer`)
  }
}

/**
 * Register `view_image` while a durable attachment store is mounted. Without
 * a store there is no honest request version and no reconstructable auxiliary
 * input. The tool's disposer is fiber-scoped.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('timeoutMs', resolved.timeoutMs)
  ctx.inject(['attachments'], (imageCtx) => {
    applyViewImageTool(imageCtx, resolved.timeoutMs)
  })
}
