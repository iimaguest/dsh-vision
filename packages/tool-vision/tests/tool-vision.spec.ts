import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { AttachmentError, AttachmentId, AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import VisionRuntime from '@deepseek-ai/dsh-vision'
import type { VisionViewProvider, VisionViewResult } from '@deepseek-ai/dsh-vision'
import * as ToolVision from '@deepseek-ai/dsh-tool-vision'
import {
  DEFAULT_VIEW_PROMPT,
  applyViewImageTool,
  formatViewOutput,
  imageMediaTypeForPath,
  presentViewCall,
  resolveViewPrompt,
} from '@deepseek-ai/dsh-tool-vision'
import { sessionCwd, sessionResolveOptions } from '../src/session-cwd.ts'
import type { ImageViewValue } from '@deepseek-ai/dsh-tool-vision'

/** 1x1 red PNG (valid signature, IHDR, IDAT). */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')

const testToolSignal = new AbortController().signal

let dir: string
let home: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-view-image-'))
  home = await mkdtemp(join(tmpdir(), 'dsh-view-image-home-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

interface SetupOptions {
  attachments?: boolean
  storeConfig?: { maxImageBytes?: number; maxImagePixels?: number; maxImageDimension?: number; maxMessageImageBytes?: number }
  view?: VisionViewProvider['view']
  available?: boolean
}

async function setup(options: SetupOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  await ctx.plugin(FsPolicy)
  if (options.attachments !== false) {
    await ctx.plugin(LocalAttachmentStore, { dshHome: home, ...options.storeConfig })
  }
  await ctx.plugin(VisionRuntime, {})
  ctx.vision.registerViewProvider({
    id: 'stub',
    available: () => options.available ?? true,
    view: options.view ?? (async () => ({ text: 'a red pixel', provider: 'stub', model: 'stub-model' })),
  })
  await ctx.plugin(ToolVision)
  return ctx
}

function agentOn(cwd = dir): object {
  return {
    options: { provider: 'visual', model: 'text-model' },
    session: {
      header: { cwd },
      requestHeader: () => ({ config: { provider: 'visual', model: 'text-model' } }),
      deriveMessages: () => [],
      append: () => undefined,
    },
  }
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown, agent?: object) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`view-call-${++callCounter}`),
    name,
    arguments: args,
    ...agent ? { agent: agent as never } : {},
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('imageMediaTypeForPath', () => {
  it('maps the four extensions case-insensitively and rejects everything else', () => {
    expect(imageMediaTypeForPath('a.png')).toBe('image/png')
    expect(imageMediaTypeForPath('a.JPG')).toBe('image/jpeg')
    expect(imageMediaTypeForPath('b.jpeg')).toBe('image/jpeg')
    expect(imageMediaTypeForPath('c.webp')).toBe('image/webp')
    expect(imageMediaTypeForPath('d.Gif')).toBe('image/gif')
    expect(imageMediaTypeForPath('note.txt')).toBeUndefined()
    expect(imageMediaTypeForPath('png')).toBeUndefined()
  })
})

describe('resolveViewPrompt', () => {
  it('uses the fixed default when the question is omitted or blank', () => {
    expect(resolveViewPrompt(undefined)).toBe(DEFAULT_VIEW_PROMPT)
    expect(resolveViewPrompt('   ')).toBe(DEFAULT_VIEW_PROMPT)
    expect(resolveViewPrompt('what is in the corner?')).toBe('what is in the corner?')
  })
})

describe('formatViewOutput', () => {
  it('emits only text naming the path, route, and description', () => {
    const value: ImageViewValue = {
      path: '/tmp/red.png',
      text: 'a red pixel',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash-vision-exp',
      image: { attachmentId: 'sha256:00', mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
      targetKey: 'k',
      version: 'v',
    }
    const out = formatViewOutput(value)
    expect(out).toContain('<path>/tmp/red.png</path>')
    expect(out).toContain('<provider>deepseek-official</provider>')
    expect(out).toContain('<model>deepseek-v4-flash-vision-exp</model>')
    expect(out).toContain('a red pixel')
    expect(out).not.toContain('type: \'image\'')
  })
})

describe('session cwd resolution', () => {
  const execution = (cwd?: string) => cwd === undefined
    ? {}
    : { agent: { session: { header: { cwd } } } }

  it('retains ordinary spelling but resolves the cwd before parent traversal', () => {
    const cwd = process.cwd()
    const throughParent = `${cwd}${sep}..`
    expect(sessionCwd(execution() as never, 'file.png')).toBeUndefined()
    expect(sessionCwd(execution(cwd) as never, 'file.png')).toBe(cwd)
    expect(sessionCwd(execution(throughParent) as never, 'file.png')).toBe(realpathSync.native(throughParent))

    const root = mkdtempSync(join(tmpdir(), 'dsh-tool-vision-session-cwd-'))
    const physical = join(root, 'physical')
    const link = join(root, 'link')
    try {
      mkdirSync(physical)
      symlinkSync(physical, link, process.platform === 'win32' ? 'junction' : 'dir')
      expect(sessionCwd(execution(link) as never, 'child.png')).toBe(link)
      expect(sessionCwd(execution(link) as never, `..${sep}parent.png`)).toBe(realpathSync.native(link))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('omits cwd from resolve options when no session workspace applies', () => {
    const signal = testToolSignal
    const cwd = process.cwd()
    expect(sessionResolveOptions({ signal } as never, 'file.png')).toEqual({ signal })
    expect(sessionResolveOptions({ signal, agent: { session: { header: { cwd } } } } as never, 'file.png'))
      .toEqual({ cwd, signal })
  })
})

describe('presentViewCall', () => {
  it('presents a generic read card with a follow-along location', () => {
    expect(presentViewCall({ file_path: 'red.png' })).toEqual({
      card: 'generic',
      title: 'View image red.png',
      kind: 'read',
      locations: [{ path: 'red.png' }],
    })
  })
})

describe('view_image happy path', () => {
  it('succeeds on a text-only conversation route and renders text only', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup()
    const result = await call(ctx, 'view_image', { file_path: 'red.png' }, agentOn())
    expect(result.isError).toBe(false)
    expect(result.content.every(block => block.type === 'text')).toBe(true)
    expect(text(result)).toContain('a red pixel')
    expect(text(result)).toContain('<provider>stub</provider>')
    expect(result.content.some(block => block.type === 'image')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('forwards the resolved prompt and attachment to ctx.vision.view', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    let seen: { prompt: string; attachmentId: string } | undefined
    const ctx = await setup({
      view: async (request) => {
        seen = { prompt: request.prompt, attachmentId: request.attachment.attachmentId }
        return { text: 'ok', provider: 'stub', model: 'stub-model' }
      },
    })
    await call(ctx, 'view_image', { file_path: 'red.png', question: 'transcribe the error' }, agentOn())
    expect(seen?.prompt).toBe('transcribe the error')
    expect(seen?.attachmentId.length).toBeGreaterThan(0)
    await ctx.fiber.dispose()
  })

  it('uses the default prompt when question is omitted', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    let prompt: string | undefined
    const ctx = await setup({
      view: async (request) => {
        prompt = request.prompt
        return { text: 'ok', provider: 'stub', model: 'stub-model' }
      },
    })
    await call(ctx, 'view_image', { file_path: 'red.png' }, agentOn())
    expect(prompt).toBe(DEFAULT_VIEW_PROMPT)
    await ctx.fiber.dispose()
  })
})

describe('view_image admission', () => {
  it('rejects a blank path and a non-image extension before calling the provider', async () => {
    let viewed = false
    const ctx = await setup({
      view: async () => {
        viewed = true
        return { text: 'ok', provider: 'stub', model: 'stub-model' }
      },
    })
    const empty = await call(ctx, 'view_image', { file_path: '   ' }, agentOn())
    expect(empty.isError).toBe(true)
    expect(text(empty)).toContain('file_path must be a non-empty string')
    const nonImage = await call(ctx, 'view_image', { file_path: 'notes.txt' }, agentOn())
    expect(nonImage.isError).toBe(true)
    expect(text(nonImage)).toContain('view_image only accepts PNG/JPEG/WebP/GIF paths')
    expect(viewed).toBe(false)
    await ctx.fiber.dispose()
  })

  it('maps attachment admission failures before the provider is called', async () => {
    await writeFile(join(dir, 'wrong.jpg'), PNG_1X1)
    let viewed = false
    const ctx = await setup({
      view: async () => {
        viewed = true
        return { text: 'ok', provider: 'stub', model: 'stub-model' }
      },
    })
    const result = await call(ctx, 'view_image', { file_path: 'wrong.jpg' }, agentOn())
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/extension declares image\/jpeg/)
    expect(viewed).toBe(false)
    await ctx.fiber.dispose()
  })

  it('reports a missing file as FS_NOT_FOUND', async () => {
    const ctx = await setup()
    const missing = await call(ctx, 'view_image', { file_path: 'absent.png' }, agentOn())
    expect(missing.isError).toBe(true)
    expect(text(missing)).toMatch(/not found/)
    await ctx.fiber.dispose()
  })

  it('reports a directory as FS_NOT_REGULAR_FILE', async () => {
    await mkdir(join(dir, 'folder.png'))
    const ctx = await setup()
    const directory = await call(ctx, 'view_image', { file_path: 'folder.png' }, agentOn())
    expect(directory.isError).toBe(true)
    expect(text(directory)).toMatch(/not a regular file/)
    await ctx.fiber.dispose()
  })
})

describe('view_image registration', () => {
  it('stays registered when the selected provider is unavailable', async () => {
    const ctx = await setup({ available: false })
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('view_image')
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const result = await call(ctx, 'view_image', { file_path: 'red.png' }, agentOn())
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/no usable vision provider is registered/)
    await ctx.fiber.dispose()
  })

  it('does not register without an attachment store', async () => {
    const ctx = await setup({ attachments: false })
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('view_image')
    await ctx.fiber.dispose()
  })

  it('rejects timeoutMs: 0 at plugin construction', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: dir })
    await ctx.plugin(VisionRuntime, {})
    await expect(ctx.plugin(ToolVision, { timeoutMs: 0 }))
      .rejects.toThrow(/tool-vision: timeoutMs must be a positive integer/)
  })

  it('registers through applyViewImageTool and refuses execute without a store', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: dir })
    await ctx.plugin(VisionRuntime, {})
    applyViewImageTool(ctx, 60_000)
    const result = await call(ctx, 'view_image', { file_path: 'red.png' }, agentOn())
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/no attachment service is mounted/)
    expect(ctx.tools.executionMode({
      signal: testToolSignal, callId: ToolCallId('view-parallel'), name: 'view_image', arguments: { file_path: 'a.png' },
    })).toEqual({ kind: 'parallel' })
    await ctx.fiber.dispose()
  })
})

describe('view_image attachment mapping', () => {
  it('returns the canonical value including optional image fields', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup()
    const result = await call(ctx, 'view_image', { file_path: 'red.png' }, agentOn())
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({
      text: 'a red pixel',
      provider: 'stub',
      model: 'stub-model',
      image: { mediaType: 'image/png', width: 1, height: 1, name: 'red.png' },
    })
    await ctx.fiber.dispose()
  })

  it('maps dimension, pixel, byte, 16-bit, and unrelated attachment failures', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    // The final entry is deliberately a plain Error: view.ts rethrows any
    // non-AttachmentError untouched, so the mapping must not swallow it.
    const refusals: (AttachmentError | Error)[] = [
      new AttachmentError('too wide', 'IMAGE_DIMENSION_TOO_LARGE'),
      new AttachmentError('too many pixels', 'IMAGE_TOO_MANY_PIXELS'),
      new AttachmentError('too large', 'IMAGE_TOO_LARGE'),
      new AttachmentError('16-bit PNG could not be converted', 'ATTACHMENT_WRITE_FAILED'),
      new AttachmentError('disk gone', 'ATTACHMENT_WRITE_FAILED'),
      new Error('unrelated infrastructure failure'),
    ]
    for (const refusal of refusals) {
      const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(LocalFileSystem, { cwd: dir })
      await ctx.plugin(FsPolicy)
      class MappingStore extends AttachmentStore {
        readonly imageLimits: ImageAttachmentLimits = Object.freeze({
          maxImageBytes: 20 * 1024 * 1024,
          maxImagesPerMessage: 20,
          maxMessageImageBytes: 200 * 1024 * 1024,
          maxImagePixels: 64_000_000,
          maxImageDimension: 8192,
          mediaTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const),
        })

        override validateImage(): Promise<void> {
          return Promise.resolve()
        }

        override saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
          return Promise.reject(refusal)
        }

        override readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
          return Promise.reject(new Error('unused'))
        }
      }
      await ctx.plugin(MappingStore)
      await ctx.plugin(VisionRuntime, {})
      ctx.vision.registerViewProvider({
        id: 'stub',
        available: () => true,
        view: () => Promise.resolve({ text: 'ok', provider: 'stub', model: 'stub-model' } satisfies VisionViewResult),
      })
      await ctx.plugin(ToolVision)
      const result = await call(ctx, 'view_image', { file_path: 'red.png' }, agentOn())
      expect(result.isError).toBe(true)
      if (refusal instanceof AttachmentError && refusal.code === 'IMAGE_DIMENSION_TOO_LARGE') expect(text(result)).toMatch(/side exceeds/)
      else if (refusal instanceof AttachmentError && refusal.code === 'IMAGE_TOO_MANY_PIXELS') expect(text(result)).toMatch(/pixel decoded-size/)
      else if (refusal instanceof AttachmentError && refusal.code === 'IMAGE_TOO_LARGE') expect(text(result)).toMatch(/byte limits/)
      else if (refusal instanceof AttachmentError && /16-bit PNG/u.test(refusal.message)) expect(text(result)).toMatch(/16-bit PNG/)
      else if (refusal instanceof AttachmentError) expect(text(result)).toMatch(/disk gone/)
      else expect(text(result)).toMatch(/unrelated infrastructure failure/)
      await ctx.fiber.dispose()
    }
  })

  it('keeps originalDimensions on the canonical value when storage downscales', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: dir })
    await ctx.plugin(FsPolicy)
    class DownscalingStore extends AttachmentStore {
      readonly imageLimits: ImageAttachmentLimits = Object.freeze({
        maxImageBytes: 1024,
        maxImagesPerMessage: 1,
        maxMessageImageBytes: 1024,
        maxImagePixels: 100,
        maxImageDimension: 2000,
        mediaTypes: Object.freeze(['image/png'] as const),
      })

      override validateImage(): Promise<void> {
        return Promise.resolve()
      }

      override saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
        return Promise.resolve({
          attachmentId: AttachmentId('sha256:feed'),
          mediaType: input.mediaType,
          bytes: 7,
          width: 2,
          height: 1,
          originalDimensions: { width: 4, height: 2 },
        })
      }

      override readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
        return Promise.reject(new Error('unused'))
      }
    }
    await ctx.plugin(DownscalingStore)
    await ctx.plugin(VisionRuntime, {})
    ctx.vision.registerViewProvider({
      id: 'stub',
      available: () => true,
      view: () => Promise.resolve({ text: 'ok', provider: 'stub', model: 'stub-model' }),
    })
    await ctx.plugin(ToolVision)
    const result = await call(ctx, 'view_image', { file_path: 'red.png' }, agentOn())
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({
      image: { originalDimensions: { width: 4, height: 2 } },
    })
    expect((result.value as unknown as ImageViewValue).image.name).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('refuses a media type the deployment does not accept', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup({
      storeConfig: { maxImageBytes: 1024 },
    })
    const attachments = ctx.get('attachments')
    if (attachments === undefined) throw new Error('expected attachments')
    Object.defineProperty(attachments, 'imageLimits', {
      value: { ...attachments.imageLimits, mediaTypes: ['image/jpeg'] },
    })
    const result = await call(ctx, 'view_image', { file_path: 'red.png' }, agentOn())
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/not accepted by this deployment/)
    await ctx.fiber.dispose()
  })
})
