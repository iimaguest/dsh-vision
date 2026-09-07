/**
 * The model-facing `view_image` tool: send one local image to a configured
 * auxiliary vision route and return text. Execution goes through `ctx.vision`
 * — this module owns only the model-facing schema, filesystem admission,
 * `saveImage`, result formatting, and presentation, never provider selection
 * or network access.
 * @module @deepseek-ai/dsh-tool-vision/view
 */

import { basename, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-vision'
import { viewPresentationMeta, fsObservedValueFields } from './fs-observed-meta.ts'
import { resolveRegularReadTarget } from './read-target.ts'

/** Extensions `view_image` accepts; magic-byte validation at the attachment service stays authoritative. */
const IMAGE_EXTENSIONS: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

const IMAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
  },
} as const

/**
 * Default inspection prompt when the model omits `question`. Provider-neutral:
 * describe the image for a coding assistant, transcribe visible text, and name
 * layout, errors, and coordinates when they matter.
 */
export const DEFAULT_VIEW_PROMPT
  = 'Describe this image for a coding assistant. Transcribe visible text. Name layout, errors, and coordinates when they matter.'

/** Model-facing `view_image` arguments. */
export interface ImageViewArgs {
  file_path: string
  question?: string
}

/** The structured outcome declared by the `view_image` output schema. */
export interface ImageViewValue {
  path: string
  text: string
  provider: string
  model: string
  image: {
    attachmentId: string
    mediaType: ImageMediaType
    bytes: number
    width: number
    height: number
    name?: string
    /** Orientation-applied file dimensions before normalization; present only when storage reduced it. */
    originalDimensions?: {
      width: number
      height: number
    }
  }
  /** Opaque observed-state carrier: never rendered, re-projected into `meta.fsObserved`. */
  targetKey: string
  /** Opaque observed version (the read's stat version), re-projected into `meta.fsObserved`. */
  version: string
}

/**
 * Map a model-supplied path to its declared image media type by extension.
 * @param filePath - the raw `file_path` argument (not yet resolved).
 * @returns the declared media type, or undefined when the path does not claim an image.
 */
export function imageMediaTypeForPath(filePath: string): ImageMediaType | undefined {
  return IMAGE_EXTENSIONS[extname(filePath).toLowerCase()]
}

/**
 * Resolve the inspection prompt the auxiliary model sees. A blank `question`
 * is treated as omitted so the tool never sends whitespace-only text.
 * @param question - the optional model-supplied question.
 * @returns the non-empty prompt.
 */
export function resolveViewPrompt(question: string | undefined): string {
  if (question === undefined) return DEFAULT_VIEW_PROMPT
  const trimmed = question.trim()
  return trimmed.length === 0 ? DEFAULT_VIEW_PROMPT : trimmed
}

/**
 * Format a view result as the model-facing text. The conversation model must
 * never receive an image block from this tool.
 * @param value - the structured view outcome.
 * @returns the resolved path, auxiliary route, and description.
 */
export function formatViewOutput(value: ImageViewValue): string {
  return `<path>${value.path}</path>
<provider>${value.provider}</provider>
<model>${value.model}</model>
<content>
${value.text}
</content>`
}

/**
 * Pending-call presentation: a generic read card with a follow-along location.
 * @param args - the raw tool arguments; only the path feeds the view.
 * @returns the generic card view (`kind: 'read'`) shown while the call runs.
 */
export function presentViewCall(args: ImageViewArgs): GenericCallView {
  return {
    card: 'generic',
    title: `View image ${args.file_path}`,
    kind: 'read',
    locations: [{ path: args.file_path }],
  }
}

/**
 * Register the `view_image` tool and its system-prompt guidance.
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the
 *   registrations; both are effect-scoped and unregister on plugin dispose.
 * @param timeoutMs - the cooperative tool-call budget (ms) attached as the
 *   tool's `ToolDefinition.timeoutMs`.
 */
export function applyViewImageTool(ctx: Context, timeoutMs: number): void {
  ctx.systemPrompt.section({
    name: 'tool:view_image',
    order: 111,
    text: 'Use the view_image tool to inspect a local PNG/JPEG/WebP/GIF when the conversation model cannot take image input, or when a configured vision specialist should answer a question about the file. Use read_image only when the current model declares image input and the pixels themselves must reach the next conversation request (for example coordinate work on the attached raster). view_image returns text. It does not attach the image to the conversation.',
  })

  ctx.tools.register(defineTool({
    name: 'view_image',
    description: 'Inspect a local PNG/JPEG/WebP/GIF with a configured vision model and return text. '
      + 'Use this when the conversation model cannot take image input, or when a vision specialist should answer a question about the file. '
      + 'It does not attach the image to the conversation. Independent files may be viewed concurrently.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to the image file, resolved by the filesystem backend.' },
      question: { type: 'string', description: 'What to inspect. Omitted means describe the image for a coding assistant, transcribe visible text, and name layout, errors, and coordinates when they matter.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          text: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          image: IMAGE_VALUE_SCHEMA,
          targetKey: { type: 'string', required: true },
          version: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatViewOutput(value) }],
      presentationMeta: (_args, value) => viewPresentationMeta(value.targetKey, value.version, value.image.attachmentId),
    },
    timeoutMs,
    // Content-addressed attachment writes are idempotent, and viewing does
    // not mutate parent-agent state.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')

      const mediaType = imageMediaTypeForPath(args.file_path)
      if (mediaType === undefined) {
        throw new Error(`cannot view "${args.file_path}": view_image only accepts PNG/JPEG/WebP/GIF paths`)
      }
      const attachments = ctx.get('attachments')
      if (attachments === undefined) {
        throw new Error(`cannot view "${args.file_path}" as an image: no attachment service is mounted`)
      }
      if (!attachments.imageLimits.mediaTypes.includes(mediaType)) {
        throw new Error(`cannot view "${args.file_path}": ${mediaType} images are not accepted by this deployment`)
      }

      const { target, info } = await resolveRegularReadTarget(ctx, exec, args.file_path)

      const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
      const data = await ctx.fs.readBytes(target, exec.signal, byteCap)
      let ref: ImageAttachmentRef
      try {
        ref = await attachments.saveImage({ data, mediaType, name: basename(target.displayPath) })
      } catch (error: unknown) {
        if (!(error instanceof AttachmentError)) throw error
        if (error.code === 'IMAGE_DIMENSION_TOO_LARGE') {
          throw new Error(
            `cannot view "${target.displayPath}": at least one image side exceeds the ${attachments.imageLimits.maxImageDimension}px limit; downscale the image and view the smaller copy`,
            { cause: error },
          )
        }
        if (error.code === 'IMAGE_TOO_MANY_PIXELS') {
          throw new Error(
            `cannot view "${target.displayPath}": the image exceeds the ${attachments.imageLimits.maxImagePixels}-pixel decoded-size limit; downscale the image and view the smaller copy`,
            { cause: error },
          )
        }
        if (error.code === 'IMAGE_TOO_LARGE') {
          throw new Error(
            `cannot view "${target.displayPath}": the image cannot be stored within the deployment's byte limits; downscale the image and view the smaller copy`,
            { cause: error },
          )
        }
        if (error.code === 'ATTACHMENT_WRITE_FAILED' && /16-bit PNG/iu.test(error.message)) {
          throw new Error(
            `cannot view "${target.displayPath}": the 16-bit PNG could not be converted to the normalized 8-bit sRGB form; convert it to an 8-bit PNG/JPEG/WebP and retry`,
            { cause: error },
          )
        }
        if (error.code !== 'IMAGE_TYPE_MISMATCH') throw error
        const extension = extname(target.displayPath).toLowerCase()
        throw new Error(
          `cannot view "${target.displayPath}": the ${extension} extension declares ${mediaType}, but the bytes use a different image format; rename the file to match its actual format if it is PNG/JPEG/WebP/GIF, or convert it to one of those formats`,
          { cause: error },
        )
      }
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      const result = await ctx.vision.view({
        attachment: ref,
        prompt: resolveViewPrompt(args.question),
      }, exec.signal)
      const value: ImageViewValue = {
        path: target.displayPath,
        text: result.text,
        provider: result.provider,
        model: result.model,
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...ref.name === undefined ? {} : { name: ref.name },
          ...ref.originalDimensions === undefined ? {} : {
            originalDimensions: { ...ref.originalDimensions },
          },
        },
        ...fsObservedValueFields(target.targetKey, info.version),
      }
      return value
    },
    presentCall: presentViewCall,
  }))
}
