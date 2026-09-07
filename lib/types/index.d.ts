/**
 * Service Definition for the vision inspection capability seam (`ctx.vision`):
 * a name-keyed view-provider registry and execution-time selection. Duplicate
 * ids are rejected. At execution time, a configured provider must exist and be
 * usable; without one, exactly one usable provider is required, so selection
 * never depends on registration order.
 * @module @deepseek-ai/dsh-vision
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { VisionViewProvider, VisionViewRequest, VisionViewResult } from './types.js';
export { VisionError, } from './types.js';
export type { VisionViewProvider, VisionViewRequest, VisionViewResult, } from './types.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        vision: VisionRuntime;
    }
}
/**
 * Config for the vision seam. `viewProvider` pins which provider wins; it is
 * optional (a single registered usable provider auto-selects). Operational
 * overrides such as environment variables must feed this same field rather
 * than introduce a hidden priority chain.
 */
export interface VisionRuntimeConfig {
    /** Explicit view provider id. Omitted = auto-select when exactly one usable. */
    readonly viewProvider?: string;
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
export declare class VisionRuntime extends Service {
    /**
     * Provider selection config. Operational env overrides feed the SAME field:
     * `$DSH_VISION_VIEW_PROVIDER` is equivalent to `viewProvider` and is NOT a
     * hidden priority chain.
     */
    static Config: z<VisionRuntimeConfig>;
    private viewProviders;
    private readonly viewProviderId;
    constructor(ctx: Context, config?: VisionRuntimeConfig);
    /**
     * Register a view provider. Throws {@link VisionError} `VISION_DUPLICATE_PROVIDER`
     * if its id is already registered. Returns a disposer; disposed with the
     * calling fiber.
     * @param provider - the provider; its `id` is the registry key.
     * @returns the disposer that unregisters the provider.
     */
    registerViewProvider(provider: VisionViewProvider): () => void;
    private registerProvider;
    /**
     * Run one view through the selected provider. Resolves the provider at call
     * time with the selection rules above; throws {@link VisionError} when the
     * capability cannot run.
     * @param request - the attachment and inspection prompt.
     * @param signal - optional cancellation signal forwarded to the provider.
     * @returns the provider's text result and route identity.
     */
    view(request: VisionViewRequest, signal?: AbortSignal): Promise<VisionViewResult>;
}
export default VisionRuntime;
//# sourceMappingURL=index.d.ts.map