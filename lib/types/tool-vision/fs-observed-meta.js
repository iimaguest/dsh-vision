/**
 * Observed-state carrier for `view_image`: the two opaque output-value fields
 * (`targetKey`/`version`) and the `meta.fsObserved` marker projected from them.
 * @module @deepseek-ai/dsh-tool-vision/fs-observed-meta
 */
import { FS_OBSERVED_META_KEY, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs';
/**
 * Build the two opaque output fields an observing tool returns.
 * @param targetKey - the observed target's opaque key.
 * @param version - the observed version (the read's stat version).
 * @returns the output-value fields to spread into the canonical result.
 */
export function fsObservedValueFields(targetKey, version) {
    return { targetKey: FsTargetKey(targetKey), version: FsVersion(version) };
}
/**
 * Project the observed target/version pair plus the durable attachment id into
 * `tool/result.meta`. The fs-observation-policy fold revives `fsObserved`; the
 * attachment id is available for a future card thumbnail.
 * @param targetKey - the observed target's opaque key.
 * @param version - the observed version.
 * @param attachmentId - durable attachment id committed before the view.
 * @returns JSON-serializable presentation meta.
 */
export function viewPresentationMeta(targetKey, version, attachmentId) {
    return {
        [FS_OBSERVED_META_KEY]: {
            kind: 'present',
            targetKey: FsTargetKey(targetKey),
            version: FsVersion(version),
        },
        attachmentId,
    };
}
//# sourceMappingURL=fs-observed-meta.js.map