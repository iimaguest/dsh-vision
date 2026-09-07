/**
 * Observed-state carrier for `view_image`: the two opaque output-value fields
 * (`targetKey`/`version`) and the `meta.fsObserved` marker projected from them.
 * @module @deepseek-ai/dsh-tool-vision/fs-observed-meta
 */
import { FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
/** Opaque target identity, declared by the tool output schema as a plain string. */
export interface FsObservedValueFields {
    /** Opaque key of the observed target, re-projected into `meta.fsObserved`. */
    targetKey: FsTargetKey;
    /** Opaque observed version, re-projected into `meta.fsObserved`. */
    version: FsVersion;
}
/**
 * Build the two opaque output fields an observing tool returns.
 * @param targetKey - the observed target's opaque key.
 * @param version - the observed version (the read's stat version).
 * @returns the output-value fields to spread into the canonical result.
 */
export declare function fsObservedValueFields(targetKey: string, version: string): FsObservedValueFields;
/**
 * Project the observed target/version pair plus the durable attachment id into
 * `tool/result.meta`. The fs-observation-policy fold revives `fsObserved`; the
 * attachment id is available for a future card thumbnail.
 * @param targetKey - the observed target's opaque key.
 * @param version - the observed version.
 * @param attachmentId - durable attachment id committed before the view.
 * @returns JSON-serializable presentation meta.
 */
export declare function viewPresentationMeta(targetKey: string, version: string, attachmentId: string): JsonValue;
//# sourceMappingURL=fs-observed-meta.d.ts.map