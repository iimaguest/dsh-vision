/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-vision`.
 * @module @deepseek-ai/dsh-vision/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-vision';
/** Cordis companion plugin name. */
export const name = 'vision-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: provider maps are private and selection is enforced on
 * each call; the seam publishes no independent registry or request/result
 * observation stream.
 */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
//# sourceMappingURL=invariant.js.map