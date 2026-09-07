import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import {
  DeepSeekViewProvider,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_IMAGE_MAX_BYTES,
  DEEPSEEK_DEFAULT_IMAGE_PIXEL_BUDGET,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MODEL,
} from '@deepseek-ai/dsh-vision-deepseek'
import type { DeepSeekViewProviderOptions } from '@deepseek-ai/dsh-vision-deepseek'

const viewProvider = (options: DeepSeekViewProviderOptions): DeepSeekViewProvider =>
  new DeepSeekViewProvider(() => options)

/**
 * With-key probe against the official vision model. Self-skips without
 * `DEEPSEEK_API_KEY`. Mocks cannot confirm the chat-completions image wire.
 */
const apiKey = process.env.DEEPSEEK_API_KEY
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

maybe('DeepSeekViewProvider real API', () => {
  it('returns text for a live vision-exp request on a tiny PNG', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-vision-e2e-'))
    const ctx = new Context()
    try {
      await ctx.plugin(LocalAttachmentStore, { dshHome: home })
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
        'base64',
      )
      const ref = await ctx.attachments.saveImage({ data: png, mediaType: 'image/png', name: 'red.png' })
      const provider = viewProvider({
        apiKey: apiKey!,
        baseURL: process.env.DEEPSEEK_BASE_URL ?? DEEPSEEK_DEFAULT_BASE_URL,
        model: process.env.DEEPSEEK_VISION_MODEL ?? DEEPSEEK_DEFAULT_MODEL,
        maxTokens: DEEPSEEK_DEFAULT_MAX_TOKENS,
        imagePixelBudget: DEEPSEEK_DEFAULT_IMAGE_PIXEL_BUDGET,
        imageMaxBytes: DEEPSEEK_DEFAULT_IMAGE_MAX_BYTES,
        resolveAttachments: () => ctx.attachments,
      })
      const result = await provider.view({
        attachment: ref,
        prompt: 'Reply with the single word PIXEL if you can see an image.',
      })
      expect(result.text.trim().length).toBeGreaterThan(0)
      expect(result.provider).toBe('deepseek-official')
      expect(result.model).toBe(process.env.DEEPSEEK_VISION_MODEL ?? DEEPSEEK_DEFAULT_MODEL)
    } finally {
      await ctx.fiber.dispose()
      await rm(home, { recursive: true, force: true })
    }
  }, 60_000)
})
