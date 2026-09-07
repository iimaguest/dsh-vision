import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import VisionRuntime, {
  VisionError,
  type VisionViewProvider,
  type VisionViewRequest,
  type VisionViewResult,
} from '@deepseek-ai/dsh-vision'

const attachment: ImageAttachmentRef = {
  attachmentId: AttachmentId('sha256:00'),
  mediaType: 'image/png',
  bytes: 1,
  width: 1,
  height: 1,
}

/** A scripted view provider for contract tests. */
function makeViewProvider(
  id: string,
  available: boolean,
  view: (request: VisionViewRequest) => Promise<VisionViewResult>,
): VisionViewProvider {
  return { id, available: () => available, view: request => view(request) }
}

const available = true
const unavailable = false

function viewResult(marker: string): VisionViewResult {
  return { text: marker, provider: 'stub', model: 'stub-model' }
}

/** Mount a VisionRuntime on a fresh root context with the given config. */
async function mountVision(config: ConstructorParameters<typeof VisionRuntime>[1] = {}): Promise<{ ctx: Context; vision: VisionRuntime }> {
  const ctx = new Context()
  await ctx.plugin(VisionRuntime, config)
  return { ctx, vision: ctx.vision }
}

describe('VisionRuntime registration', () => {
  it('registers a view provider and unregisters it via the returned disposer', async () => {
    const { vision } = await mountVision()

    const dispose = vision.registerViewProvider(makeViewProvider('deepseek-official', available, () => Promise.resolve(viewResult('ok'))))
    await expect(vision.view({ attachment, prompt: 'q' })).resolves.toMatchObject({ text: 'ok' })

    dispose()
    await expect(vision.view({ attachment, prompt: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_UNAVAILABLE' }))
  })

  it('throws VISION_DUPLICATE_PROVIDER on a duplicate view id', async () => {
    const { vision } = await mountVision()
    vision.registerViewProvider(makeViewProvider('deepseek-official', available, () => Promise.resolve(viewResult('ok'))))
    expect(() => vision.registerViewProvider(makeViewProvider('deepseek-official', available, () => Promise.resolve(viewResult('ok')))))
      .toThrow(expect.objectContaining({ code: 'VISION_DUPLICATE_PROVIDER' }))
  })

  it('disposes provider registrations when the contributing fiber is disposed (HMR safety)', async () => {
    const { ctx, vision } = await mountVision()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.vision.registerViewProvider(makeViewProvider('deepseek-official', available, () => Promise.resolve(viewResult('ok'))))
    }, { inject: ['vision'] }))
    await expect(vision.view({ attachment, prompt: 'q' })).resolves.toMatchObject({ text: 'ok' })
    await fiber.dispose()
    await expect(vision.view({ attachment, prompt: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_UNAVAILABLE' }))
  })
})

describe('VisionRuntime execution resolution', () => {
  it('throws VISION_PROVIDER_UNAVAILABLE when nothing is registered', async () => {
    const { vision } = await mountVision()
    await expect(vision.view({ attachment, prompt: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_UNAVAILABLE' }))
  })

  it('throws VISION_PROVIDER_UNAVAILABLE when providers exist but none are usable', async () => {
    const { vision } = await mountVision()
    vision.registerViewProvider(makeViewProvider('deepseek-official', unavailable, () => Promise.resolve(viewResult('ok'))))
    await expect(vision.view({ attachment, prompt: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_UNAVAILABLE' }))
  })

  it('throws VISION_PROVIDER_CONFIGURED_MISSING for an unregistered configured id', async () => {
    const { vision } = await mountVision({ viewProvider: 'other' })
    vision.registerViewProvider(makeViewProvider('deepseek-official', available, () => Promise.resolve(viewResult('ok'))))
    await expect(vision.view({ attachment, prompt: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('throws VISION_PROVIDER_CONFIGURED_UNAVAILABLE for an unusable configured id', async () => {
    const { vision } = await mountVision({ viewProvider: 'deepseek-official' })
    vision.registerViewProvider(makeViewProvider('deepseek-official', unavailable, () => Promise.resolve(viewResult('ok'))))
    await expect(vision.view({ attachment, prompt: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_CONFIGURED_UNAVAILABLE' }))
  })

  it('throws VISION_PROVIDER_AMBIGUOUS rather than picking by order', async () => {
    const { vision } = await mountVision()
    vision.registerViewProvider(makeViewProvider('a', available, () => Promise.resolve(viewResult('a'))))
    vision.registerViewProvider(makeViewProvider('b', available, () => Promise.resolve(viewResult('b'))))
    await expect(vision.view({ attachment, prompt: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'VISION_PROVIDER_AMBIGUOUS' }))
  })

  it('runs the configured provider even when another usable provider is registered', async () => {
    const { vision } = await mountVision({ viewProvider: 'b' })
    vision.registerViewProvider(makeViewProvider('a', available, () => Promise.resolve(viewResult('a'))))
    vision.registerViewProvider(makeViewProvider('b', available, () => Promise.resolve(viewResult('b'))))
    await expect(vision.view({ attachment, prompt: 'q' })).resolves.toMatchObject({ text: 'b' })
  })

  it('ignores unusable providers when auto-selecting', async () => {
    const { vision } = await mountVision()
    vision.registerViewProvider(makeViewProvider('a', available, () => Promise.resolve(viewResult('a'))))
    vision.registerViewProvider(makeViewProvider('b', unavailable, () => Promise.resolve(viewResult('b'))))
    await expect(vision.view({ attachment, prompt: 'q' })).resolves.toMatchObject({ text: 'a' })
  })

  it('does not let registration order change auto-selection', async () => {
    const a = await mountVision()
    a.vision.registerViewProvider(makeViewProvider('a', unavailable, () => Promise.resolve(viewResult('a'))))
    a.vision.registerViewProvider(makeViewProvider('b', available, () => Promise.resolve(viewResult('b'))))
    await expect(a.vision.view({ attachment, prompt: 'q' })).resolves.toMatchObject({ text: 'b' })

    const b = await mountVision()
    b.vision.registerViewProvider(makeViewProvider('b', available, () => Promise.resolve(viewResult('b'))))
    b.vision.registerViewProvider(makeViewProvider('a', unavailable, () => Promise.resolve(viewResult('a'))))
    await expect(b.vision.view({ attachment, prompt: 'q' })).resolves.toMatchObject({ text: 'b' })
  })

  it('propagates the abort signal to the provider', async () => {
    const { vision } = await mountVision()
    const seen: (AbortSignal | undefined)[] = []
    vision.registerViewProvider({
      id: 'deepseek-official',
      available: () => available,
      view: (_request, signal) => { seen.push(signal); return Promise.resolve(viewResult('ok')) },
    })
    const controller = new AbortController()
    await vision.view({ attachment, prompt: 'q' }, controller.signal)
    expect(seen[0]).toBe(controller.signal)
  })
})

describe('VisionError', () => {
  it('is a HarnessError carrying its code', () => {
    const error = new VisionError('boom', 'VISION_PROVIDER_ERROR')
    expect(error.code).toBe('VISION_PROVIDER_ERROR')
    expect(error.name).toBe('VisionError')
  })
})
