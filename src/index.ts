/**
 * Service Definition for the vision inspection capability seam (`ctx.vision`):
 * a name-keyed view-provider registry and execution-time selection. Duplicate
 * ids are rejected. At execution time, a configured provider must exist and be
 * usable; without one, exactly one usable provider is required, so selection
 * never depends on registration order.
 * @module @deepseek-ai/dsh-vision
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  VisionViewProvider,
  VisionViewRequest,
  VisionViewResult,
} from './types.ts'
import { VisionError } from './types.ts'

export {
  VisionError,
} from './types.ts'
export type {
  VisionViewProvider,
  VisionViewRequest,
  VisionViewResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    vision: VisionRuntime
  }
}

/** Selection inputs for execution-time provider resolution. */
interface Selection<P> {
  /** The configured provider id for this capability, if any. */
  readonly configuredId?: string
  /** Providers registered for this capability kind. */
  readonly providers: ReadonlyMap<string, P>
}

/**
 * Config for the vision seam. `viewProvider` pins which provider wins; it is
 * optional (a single registered usable provider auto-selects). Operational
 * overrides such as environment variables must feed this same field rather
 * than introduce a hidden priority chain.
 */
export interface VisionRuntimeConfig {
  /** Explicit view provider id. Omitted = auto-select when exactly one usable. */
  readonly viewProvider?: string
}

/**
 * The vision inspection service. Registered as `ctx.vision` (one instance per context).
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured id that is registered and `available()` → that provider.
 * - A configured id not registered → `VISION_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable →
 *   `VISION_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `VISION_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `VISION_PROVIDER_UNAVAILABLE`.
 */
export class VisionRuntime extends Service {
  /**
   * Provider selection config. Operational env overrides feed the SAME field:
   * `$DSH_VISION_VIEW_PROVIDER` is equivalent to `viewProvider` and is NOT a
   * hidden priority chain.
   */
  static Config: z<VisionRuntimeConfig> = z.object({
    viewProvider: z.string(),
  })

  private viewProviders = new Map<string, VisionViewProvider>()
  private readonly viewProviderId: string | undefined

  constructor(ctx: Context, config: VisionRuntimeConfig = {}) {
    super(ctx, 'vision')
    this.viewProviderId = config.viewProvider ?? process.env.DSH_VISION_VIEW_PROVIDER
  }

  /**
   * Register a view provider. Throws {@link VisionError} `VISION_DUPLICATE_PROVIDER`
   * if its id is already registered. Returns a disposer; disposed with the
   * calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerViewProvider(provider: VisionViewProvider): () => void {
    return this.registerProvider(this.viewProviders, provider)
  }

  private registerProvider<P extends { readonly id: string }>(store: Map<string, P>, provider: P): () => void {
    if (store.has(provider.id)) {
      throw new VisionError(`a vision provider with id "${provider.id}" is already registered`, 'VISION_DUPLICATE_PROVIDER')
    }
    const dispose = this.ctx.effect(function* () {
      store.set(provider.id, provider)
      yield () => store.delete(provider.id)
    }, 'vision.registerViewProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * Run one view through the selected provider. Resolves the provider at call
   * time with the selection rules above; throws {@link VisionError} when the
   * capability cannot run.
   * @param request - the attachment and inspection prompt.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the provider's text result and route identity.
   */
  async view(request: VisionViewRequest, signal?: AbortSignal): Promise<VisionViewResult> {
    const provider = resolveProvider({
      providers: this.viewProviders,
      ...this.viewProviderId !== undefined ? { configuredId: this.viewProviderId } : {},
    })
    return provider.view(request, signal)
  }
}

interface ResolvableProvider {
  readonly id: string
  available(): boolean
}

/** Resolve the selected provider or throw the matching {@link VisionError}. */
function resolveProvider<P extends ResolvableProvider>(selection: Selection<P>): P {
  const { configuredId, providers } = selection
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new VisionError(`configured vision provider "${configuredId}" is not registered`, 'VISION_PROVIDER_CONFIGURED_MISSING')
    }
    if (!provider.available()) {
      throw new VisionError(`configured vision provider "${configuredId}" is registered but unavailable`, 'VISION_PROVIDER_CONFIGURED_UNAVAILABLE')
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    throw new VisionError('no usable vision provider is registered', 'VISION_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new VisionError(`multiple usable vision providers are registered (${ids}); configure one explicitly`, 'VISION_PROVIDER_AMBIGUOUS')
  }
  return single
}

export default VisionRuntime
