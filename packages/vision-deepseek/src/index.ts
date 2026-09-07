/**
 * Register a DeepSeek-backed provider in `ctx.vision`. It calls the
 * OpenAI-compatible chat-completions API with one inline image. The provider
 * reuses `DEEPSEEK_API_KEY` and honors `$DEEPSEEK_BASE_URL`, because vision
 * and conversation share the chat-completions base.
 * @module @deepseek-ai/dsh-vision-deepseek
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SettingsNamespace, SettingsSectionHooks } from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-vision'
import {
  DeepSeekViewProvider,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_IMAGE_MAX_BYTES,
  DEEPSEEK_DEFAULT_IMAGE_PIXEL_BUDGET,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MODEL,
} from './provider.ts'
import type { DeepSeekViewProviderOptions } from './provider.ts'

export {
  DeepSeekViewProvider,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_IMAGE_MAX_BYTES,
  DEEPSEEK_DEFAULT_IMAGE_PIXEL_BUDGET,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_PROVIDER_ID,
  mapChatCompletionResponse,
} from './provider.ts'
export type { DeepSeekViewLlmRequest, DeepSeekViewProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'vision-deepseek'

/** The vision seam this provider registers into. */
export const inject = ['vision']

const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal DeepSeek API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each view; defaults to `DEEPSEEK_API_KEY`. */
  apiKeyEnv?: string
  /** Chat-completions endpoint base; `/chat/completions` is appended. */
  baseURL?: string
  /** OpenAI-format model name. Defaults to `deepseek-v4-flash-vision-exp`. */
  model?: string
  /** Upper bound on generated tokens for the chat-completions request. Defaults to 4096. */
  maxTokens?: number
  /** Total-pixel budget for `readImageRequest`. Defaults to 640000. */
  imagePixelBudget?: number
  /** Encoded-byte cap for `readImageRequest`. Defaults to 1048576. */
  imageMaxBytes?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  baseURL: z.string(),
  model: z.string().default(DEEPSEEK_DEFAULT_MODEL),
  maxTokens: z.number().step(1).min(1).default(DEEPSEEK_DEFAULT_MAX_TOKENS),
  imagePixelBudget: z.number().step(1).min(1).default(DEEPSEEK_DEFAULT_IMAGE_PIXEL_BUDGET),
  imageMaxBytes: z.number().step(1).min(1).default(DEEPSEEK_DEFAULT_IMAGE_MAX_BYTES),
})

/**
 * Environment variable naming this provider's endpoint. Shared with the
 * conversation adapter because both speak chat-completions; search uses a
 * different Anthropic-compatible base and therefore a different variable.
 */
const BASE_URL_ENV = 'DEEPSEEK_BASE_URL'

/** Settings namespace carrying this provider's endpoint, model, and key reference. */
export const VISION_DEEPSEEK_SETTINGS_NAMESPACE = 'vision-deepseek' as SettingsNamespace

/**
 * Project one resolved section into the options the provider serves its next
 * view with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential, attachment, and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one view.
 */
function resolveOptions(ctx: Context, config: Config): DeepSeekViewProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(BASE_URL_ENV)?.value
      ?? DEEPSEEK_DEFAULT_BASE_URL,
    model: config.model ?? DEEPSEEK_DEFAULT_MODEL,
    maxTokens: config.maxTokens ?? DEEPSEEK_DEFAULT_MAX_TOKENS,
    imagePixelBudget: config.imagePixelBudget ?? DEEPSEEK_DEFAULT_IMAGE_PIXEL_BUDGET,
    imageMaxBytes: config.imageMaxBytes ?? DEEPSEEK_DEFAULT_IMAGE_MAX_BYTES,
    resolveAttachments: () => ctx.get('attachments'),
    recordRequest: (request) => {
      ctx.get('agents')?.currentInitiator()?.session.append(
        'vision/deepseek-view-llm-request',
        request,
      )
    },
  }
}

/** Register the DeepSeek view provider with `ctx.vision`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, VISION_DEEPSEEK_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => {
        current = source
      },
      // The registration carries no resolved value: the provider projects the
      // section per view, so a committed change needs no re-registration.
      onChange: () => {},
    } satisfies SettingsSectionHooks<Config>)
  })
  ctx.vision.registerViewProvider(new DeepSeekViewProvider(() => resolveOptions(ctx, current())))
}
