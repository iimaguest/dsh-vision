/** The `vision-deepseek` settings section layered over the composition entry. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import VisionRuntime from '@deepseek-ai/dsh-vision'
import * as deepseekPlugin from '@deepseek-ai/dsh-vision-deepseek'
import { VISION_DEEPSEEK_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-vision-deepseek'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

const attachment: ImageAttachmentRef = {
  attachmentId: AttachmentId('sha256:aa'),
  mediaType: 'image/png',
  bytes: 1,
  width: 1,
  height: 1,
}

const requestVersion: RequestImageAttachment = {
  variantId: 'variant' as RequestImageAttachment['variantId'],
  attachment,
  data: Uint8Array.from([1]),
  mediaType: 'image/png',
  bytes: 1,
  width: 1,
  height: 1,
  depth: 'uchar',
  space: 'srgb',
  hasAlpha: false,
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const ONE_RESULT = { choices: [{ message: { role: 'assistant', content: 'ok' } }] }

async function boot(): Promise<{ ctx: Context; settingsFiber: Fiber; pluginFiber: Fiber }> {
  const ctx = new Context()
  ctx.provide('attachments', {
    readImageRequest: () => Promise.resolve(requestVersion),
  } as unknown as AttachmentStore)
  await ctx.plugin(VisionRuntime, {})
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(deepseekPlugin, { apiKey: 'ds-key', baseURL: 'https://vision.entry.test' })
  await pluginFiber.await()
  return { ctx, settingsFiber, pluginFiber }
}

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * Run one view and answer the endpoint it reached.
 * @param ctx - context whose `ctx.vision` serves the view.
 * @returns the URL the provider fetched.
 */
async function viewOnce(ctx: Context): Promise<string> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(jsonResponse(ONE_RESULT)))
  fetchSpy.mockClear()
  await ctx.vision.view({ attachment, prompt: 'anything' })
  return String((fetchSpy.mock.calls.at(-1)?.[0] as URL | string | undefined) ?? '')
}

describe('vision-deepseek settings section', () => {
  it('serves a stored endpoint and model to the next view without re-registering the provider', async () => {
    const bench = await boot()
    expect(await viewOnce(bench.ctx)).toContain('https://vision.entry.test')

    await bench.ctx.settings.update(VISION_DEEPSEEK_SETTINGS_NAMESPACE, {
      baseURL: 'https://vision.stored.test',
      model: 'other-vision',
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(jsonResponse(ONE_RESULT)))
    fetchSpy.mockClear()
    await bench.ctx.vision.view({ attachment, prompt: 'anything' })
    const [url, init] = fetchSpy.mock.calls.at(-1) as unknown as [string, RequestInit]
    expect(url).toContain('https://vision.stored.test')
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'other-vision' })
    await bench.ctx.fiber.dispose()
  })

  it('keeps the literal key out of every described layer', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(VISION_DEEPSEEK_SETTINGS_NAMESPACE, { apiKey: 'ds-stored-secret' })

    const [descriptor] = bench.ctx.settings.describe({ redactSecrets: true })
      .filter(row => String(row.ns) === 'vision-deepseek')

    expect(JSON.stringify(descriptor)).not.toContain('ds-stored-secret')
    expect(descriptor?.secrets).toEqual([{ path: ['apiKey'], set: true }])
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(VISION_DEEPSEEK_SETTINGS_NAMESPACE, {
      baseURL: 'https://vision.stored.test',
    })
    expect(await viewOnce(bench.ctx)).toContain('https://vision.stored.test')

    await bench.settingsFiber.dispose()

    expect(await viewOnce(bench.ctx)).toContain('https://vision.entry.test')
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace when the plugin unloads', async () => {
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('vision-deepseek')

    await bench.pluginFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('vision-deepseek')
    await bench.ctx.fiber.dispose()
  })
})
