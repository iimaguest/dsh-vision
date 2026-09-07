import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import VisionRuntime from '@deepseek-ai/dsh-vision'
import {
  DeepSeekViewProvider,
  DEEPSEEK_PROVIDER_ID,
  mapChatCompletionResponse,
} from '@deepseek-ai/dsh-vision-deepseek'
import * as deepseekPlugin from '@deepseek-ai/dsh-vision-deepseek'
import type { DeepSeekViewProviderOptions } from '@deepseek-ai/dsh-vision-deepseek'

const attachment: ImageAttachmentRef = {
  attachmentId: AttachmentId('sha256:aa'),
  mediaType: 'image/png',
  bytes: 4,
  width: 2,
  height: 2,
  name: 'shot.png',
}

const requestVersion: RequestImageAttachment = {
  variantId: 'variant' as RequestImageAttachment['variantId'],
  attachment,
  data: Uint8Array.from([1, 2, 3]),
  mediaType: 'image/jpeg',
  bytes: 3,
  width: 1,
  height: 1,
  depth: 'uchar',
  space: 'srgb',
  hasAlpha: false,
}

function attachments(
  read: (ref: ImageAttachmentRef) => Promise<RequestImageAttachment> = () => Promise.resolve(requestVersion),
): AttachmentStore {
  return { readImageRequest: (ref: ImageAttachmentRef) => read(ref) } as unknown as AttachmentStore
}

const viewProvider = (options: DeepSeekViewProviderOptions): DeepSeekViewProvider =>
  new DeepSeekViewProvider(() => options)

const options: DeepSeekViewProviderOptions = {
  apiKey: 'ds-key',
  baseURL: 'https://api.deepseek.test',
  model: 'deepseek-v4-flash-vision-exp',
  maxTokens: 4096,
  imagePixelBudget: 640_000,
  imageMaxBytes: 1_048_576,
  resolveAttachments: () => attachments(),
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

function viewResponse(text = 'a red pixel'): unknown {
  return { choices: [{ message: { role: 'assistant', content: text } }] }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mapChatCompletionResponse', () => {
  it('returns assistant text with the serving provider and model', () => {
    expect(mapChatCompletionResponse(viewResponse() as never, 'vision-model'))
      .toEqual({ text: 'a red pixel', provider: DEEPSEEK_PROVIDER_ID, model: 'vision-model' })
  })

  it('throws VISION_PROVIDER_ERROR when assistant text is missing or empty', () => {
    expect(() => mapChatCompletionResponse({}, 'vision-model'))
      .toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_ERROR' }))
    expect(() => mapChatCompletionResponse({ choices: [{ message: { content: '' } }] }, 'vision-model'))
      .toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_ERROR' }))
  })
})

describe('DeepSeekViewProvider availability', () => {
  it('is unavailable without a key', () => {
    expect(viewProvider({ ...options, apiKey: '' }).available()).toBe(false)
  })

  it('is available with a key', () => {
    expect(viewProvider(options).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(viewProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
  })

  it('is misconfigured when the model is blank', () => {
    expect(viewProvider({ ...options, model: '   ' }).available()).toBe(false)
  })

  it('is misconfigured when request limits are not positive integers', () => {
    expect(viewProvider({ ...options, maxTokens: 0 }).available()).toBe(false)
    expect(viewProvider({ ...options, imagePixelBudget: 0 }).available()).toBe(false)
    expect(viewProvider({ ...options, imageMaxBytes: 1.5 }).available()).toBe(false)
  })
})

describe('DeepSeekViewProvider request mapping', () => {
  it('records and posts the same chat-completions request with thinking off and one image_url', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(viewResponse()))
    const recordRequest = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await viewProvider({ ...options, recordRequest }).view({ attachment, prompt: 'what is this?' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.test/chat/completions')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer ds-key')
    expect(headers['user-agent']).toBe('deepseek-harness/0.0.1')
    const body = JSON.parse(init.body as string) as {
      model: string
      max_tokens: number
      stream: boolean
      thinking: { type: string }
      messages: [{ role: string; content: { type: string; text?: string; image_url?: { url: string } }[] }]
    }
    expect(body).toMatchObject({
      model: 'deepseek-v4-flash-vision-exp',
      max_tokens: 4096,
      stream: false,
      thinking: { type: 'disabled' },
    })
    expect(body.messages[0].content[0]).toEqual({ type: 'text', text: 'what is this?' })
    expect(body.messages[0].content[1]?.type).toBe('image_url')
    expect(body.messages[0].content[1]?.image_url?.url).toBe(`data:image/jpeg;base64,${Buffer.from(requestVersion.data).toString('base64')}`)
    expect(JSON.stringify(recordRequest.mock.calls[0]?.[0])).not.toContain('ds-key')
    expect(JSON.stringify(recordRequest.mock.calls[0]?.[0])).not.toContain(Buffer.from(requestVersion.data).toString('base64'))
    expect(recordRequest).toHaveBeenCalledWith({
      endpoint: url,
      model: 'deepseek-v4-flash-vision-exp',
      max_tokens: 4096,
      prompt: 'what is this?',
      attachmentId: attachment.attachmentId,
      mediaType: 'image/jpeg',
      width: 1,
      height: 1,
      bytes: 3,
    })
    expect(recordRequest.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0] ?? 0)
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(viewResponse()))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await viewProvider(options).view({ attachment, prompt: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('DeepSeekViewProvider settings changes mid-view', () => {
  it('serves one view from one section even when settings land during credential resolution', async () => {
    const before = { ...options, apiKey: '', baseURL: 'https://before.test', model: 'model-before' }
    const after = { ...options, apiKey: '', baseURL: 'https://after.test', model: 'model-after' }
    let current = before
    let commitSettings = () => {}
    const resolveApiKey = () => new Promise<string>((resolve) => {
      commitSettings = () => { current = after; resolve('key-from-before') }
    })
    const fetchMock = vi.fn(async () => jsonResponse(viewResponse()))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new DeepSeekViewProvider(() => ({ ...current, resolveApiKey }))
    const view = provider.view({ attachment, prompt: 'q' })
    await vi.waitFor(() => { expect(typeof commitSettings).toBe('function') })
    commitSettings()
    await view

    const [endpoint, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }]
    expect(endpoint).toBe('https://before.test/chat/completions')
    expect(init.headers.authorization).toBe('Bearer key-from-before')
    expect(JSON.parse(init.body)).toMatchObject({ model: 'model-before' })
  })
})

describe('DeepSeekViewProvider error handling', () => {
  it('does not start credential resolution or dispatch for a pre-aborted call', async () => {
    const resolveApiKey = vi.fn(async () => 'late-key')
    const recordRequest = vi.fn()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort(new Error('caller stopped'))
    await expect(viewProvider({
      ...options,
      apiKey: '',
      resolveApiKey,
      recordRequest,
    }).view({ attachment, prompt: 'q' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_ABORTED' }))
    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(recordRequest).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts while an uncooperative credential resolver remains pending', async () => {
    const resolveApiKey = vi.fn(() => new Promise<string>(() => {}))
    const recordRequest = vi.fn()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const view = viewProvider({
      ...options,
      apiKey: '',
      resolveApiKey,
      recordRequest,
    }).view({ attachment, prompt: 'q' }, controller.signal)
    controller.abort(new Error('deadline'))
    await expect(view).rejects.toThrow(expect.objectContaining({ code: 'VISION_ABORTED' }))
    expect(resolveApiKey).toHaveBeenCalledOnce()
    expect(recordRequest).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the default credential reference when no resolver is configured', async () => {
    await expect(viewProvider({ ...options, apiKey: '' }).view({ attachment, prompt: 'q' }))
      .rejects.toThrow('DeepSeek vision has no API key for "DEEPSEEK_API_KEY"')
  })

  it('maps an HTTP error to VISION_PROVIDER_ERROR with the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'rate limited' } }, { status: 429 })))
    await expect(viewProvider(options).view({ attachment, prompt: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_ERROR', message: 'rate limited' }))
  })

  it('handles a string-form error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'bad request' }, { status: 400 })))
    await expect(viewProvider(options).view({ attachment, prompt: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'bad request' }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream error', { status: 503 })))
    await expect(viewProvider(options).view({ attachment, prompt: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'DeepSeek API error (HTTP 503)' }))
  })

  it('maps an abort to VISION_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(viewProvider(options).view({ attachment, prompt: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_ABORTED' }))
  })

  it('maps a custom abort reason to VISION_ABORTED', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new Error('custom abort reason')) }, { once: true })
      })))
    const view = viewProvider(options).view({ attachment, prompt: 'q' }, controller.signal)
    controller.abort(new Error('timeout reason'))
    await expect(view).rejects.toThrow(expect.objectContaining({ code: 'VISION_ABORTED' }))
  })

  it('maps an unparseable success body to VISION_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(viewProvider(options).view({ attachment, prompt: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_ERROR' }))
  })

  it('maps empty assistant text to VISION_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ choices: [{ message: { content: '' } }] })))
    await expect(viewProvider(options).view({ attachment, prompt: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as VISION_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(viewProvider(options).view({ attachment, prompt: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as VISION_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(viewProvider(options).view({ attachment, prompt: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_ABORTED' }))
  })

  it('maps a network failure to VISION_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(viewProvider(options).view({ attachment, prompt: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_ERROR' }))
  })

  it('maps a missing attachment store to VISION_PROVIDER_ERROR', async () => {
    await expect(viewProvider({ ...options, resolveAttachments: () => undefined }).view({ attachment, prompt: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_ERROR' }))
  })

  it('wraps a rejected abortable preflight that is not itself an abort', async () => {
    const controller = new AbortController()
    await expect(viewProvider({
      ...options,
      resolveAttachments: () => attachments(() => Promise.reject(new TypeError('disk gone'))),
    }).view({ attachment, prompt: 'q' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({
        code: 'VISION_PROVIDER_ERROR',
        message: 'DeepSeek vision request-image projection failed: Error: TypeError: disk gone',
      }))
  })

  it('maps a request-image projection failure to VISION_PROVIDER_ERROR', async () => {
    await expect(viewProvider({
      ...options,
      resolveAttachments: () => attachments(() => Promise.reject(new Error('projection failed'))),
    }).view({ attachment, prompt: 'q' }))
      .rejects.toThrow(expect.objectContaining({
        code: 'VISION_PROVIDER_ERROR',
        message: 'DeepSeek vision request-image projection failed: Error: projection failed',
      }))
  })

  it('maps a credential resolver rejection to VISION_PROVIDER_ERROR', async () => {
    await expect(viewProvider({
      ...options,
      apiKey: '',
      resolveApiKey: () => Promise.reject(new Error('credential backend failed')),
    }).view({ attachment, prompt: 'q' }))
      .rejects.toThrow(expect.objectContaining({
        code: 'VISION_PROVIDER_ERROR',
        message: 'DeepSeek vision credential resolution failed: Error: credential backend failed',
      }))
  })

  it('observes cancellation triggered synchronously by credential resolution', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(viewProvider({
      ...options,
      apiKey: '',
      resolveApiKey: () => {
        controller.abort(new Error('resolver cancelled caller'))
        return Promise.resolve('unused-key')
      },
    }).view({ attachment, prompt: 'q' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_ABORTED' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the status-line message when the JSON error body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(viewProvider(options).view({ attachment, prompt: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'DeepSeek API error (HTTP 500)' }))
  })

  it('surfaces an abort during request-image projection as VISION_ABORTED', async () => {
    await expect(viewProvider({
      ...options,
      resolveAttachments: () => attachments(() => Promise.reject(new DOMException('aborted', 'AbortError'))),
    }).view({ attachment, prompt: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_ABORTED' }))
  })
})

describe('vision-deepseek plugin registration', () => {
  it('registers the provider into ctx.vision (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(viewResponse())))
    const ctx = new Context()
    ctx.provide('attachments', attachments())
    await ctx.plugin(VisionRuntime, { viewProvider: DEEPSEEK_PROVIDER_ID })
    const fiber = await ctx.plugin(deepseekPlugin, { apiKey: 'ds-key' })
    await expect(ctx.vision.view({ attachment, prompt: 'q' })).resolves.toMatchObject({ text: 'a red pixel' })
    await fiber.dispose()
    await expect(ctx.vision.view({ attachment, prompt: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('rejects maxTokens: 0 at plugin construction', async () => {
    const ctx = new Context()
    await ctx.plugin(VisionRuntime, { viewProvider: DEEPSEEK_PROVIDER_ID })
    await expect(ctx.plugin(deepseekPlugin, { apiKey: 'ds-key', maxTokens: 0 }))
      .rejects.toThrow(/maxTokens expected number >= 1/)
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in deepseekPlugin).toBe(false)
  })

  it('survives the real Loader unwrapExports path keeping name/inject/Config', () => {
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(deepseekPlugin) as Record<string, unknown>
    expect(unwrapped).toBe(deepseekPlugin)
    expect(unwrapped.name).toBe('vision-deepseek')
    expect(unwrapped.inject).toEqual(['vision'])
    expect(typeof unwrapped.apply).toBe('function')
  })

  it('boots over ctx.vision through the unwrapped module without an inject error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(viewResponse())))
    const ctx = new Context()
    ctx.provide('attachments', attachments())
    await ctx.plugin(VisionRuntime, { viewProvider: DEEPSEEK_PROVIDER_ID })
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(deepseekPlugin) as Parameters<Context['plugin']>[0]
    const fiber = await ctx.plugin(unwrapped, { apiKey: 'ds-key' })
    await expect(ctx.vision.view({ attachment, prompt: 'q' })).resolves.toMatchObject({ text: 'a red pixel' })
    await fiber.dispose()
  })

  it('falls back to the env key and defaults when config omits them', async () => {
    const prev = process.env.DEEPSEEK_API_KEY
    process.env.DEEPSEEK_API_KEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse(viewResponse()))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      ctx.provide('attachments', attachments())
      await ctx.plugin(VisionRuntime, { viewProvider: DEEPSEEK_PROVIDER_ID })
      deepseekPlugin.apply(ctx, {})
      await ctx.vision.view({ attachment, prompt: 'q' })
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://api.deepseek.com/chat/completions')
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer env-key')
      expect(JSON.parse(init.body as string)).toMatchObject({ model: 'deepseek-v4-flash-vision-exp' })
      await ctx.fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = prev
    }
  })

  it('resolves the credential for each view so a stored or rotated key needs no restart', async () => {
    const previous = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    const dir = await mkdtemp(join(tmpdir(), 'dsh-vision-credentials-'))
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(viewResponse()))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      ctx.provide('attachments', attachments())
      await ctx.plugin(VisionRuntime, { viewProvider: DEEPSEEK_PROVIDER_ID })
      await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
      await ctx.plugin(deepseekPlugin, { baseURL: 'https://api.deepseek.test' })

      await expect(ctx.vision.view({ attachment, prompt: 'missing' }))
        .rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_CREDENTIAL_MISSING' }))

      const ref = credentialRef('DEEPSEEK_API_KEY')
      await ctx.credentials.set(ref, 'stored-key')
      await ctx.vision.view({ attachment, prompt: 'stored' })
      await ctx.credentials.set(ref, 'rotated-key')
      await ctx.vision.view({ attachment, prompt: 'rotated' })

      const headers = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).headers as Record<string, string>)
      expect(headers.map(value => value.authorization)).toEqual(['Bearer stored-key', 'Bearer rotated-key'])
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = previous
    }
  })

  it('resolves a separate apiKeyEnv independently of the default reference', async () => {
    const previous = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    const dir = await mkdtemp(join(tmpdir(), 'dsh-vision-separate-key-'))
    const fetchMock = vi.fn(async () => jsonResponse(viewResponse()))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      ctx.provide('attachments', attachments())
      await ctx.plugin(VisionRuntime, { viewProvider: DEEPSEEK_PROVIDER_ID })
      await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
      await ctx.plugin(deepseekPlugin, { apiKeyEnv: 'DEEPSEEK_VISION_API_KEY', baseURL: 'https://api.deepseek.test' })
      await ctx.credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'conversation-key')
      await ctx.credentials.set(credentialRef('DEEPSEEK_VISION_API_KEY'), 'vision-key')
      await ctx.vision.view({ attachment, prompt: 'q' })
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer vision-key')
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = previous
    }
  })

  it('reports an actionable credential error when neither config nor env supplies a key', async () => {
    const prev = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    try {
      const ctx = new Context()
      ctx.provide('attachments', attachments())
      await ctx.plugin(VisionRuntime, { viewProvider: DEEPSEEK_PROVIDER_ID })
      await ctx.plugin(deepseekPlugin, {})
      let caught: unknown
      try {
        await ctx.vision.view({ attachment, prompt: 'q' })
      } catch (error: unknown) {
        caught = error
      }
      expect(caught).toMatchObject({ code: 'VISION_PROVIDER_CREDENTIAL_MISSING' })
      if (!(caught instanceof Error)) throw new Error('view did not throw an Error')
      expect(caught.message).toMatch(/store it through the credentials service.*Models page/s)
    } finally {
      if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev
    }
  })
})
