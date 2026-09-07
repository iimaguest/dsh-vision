/**
 * Real Loader-path guard for an injected namespace plugin. A default export would make
 * `unwrapExports` collapse the namespace and drop `inject`, causing access to `ctx.vision` to fail.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import VisionRuntime from '@deepseek-ai/dsh-vision'
import * as toolVision from '@deepseek-ai/dsh-tool-vision'

describe('dsh-tool-vision real-load-path guard', () => {
  it('has no default export and keeps name/inject/Config through unwrapExports', () => {
    expect('default' in toolVision).toBe(false)

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(toolVision) as Record<string, unknown>
    expect(unwrapped).toBe(toolVision)
    expect(unwrapped.name).toBe('tool-vision')
    expect(unwrapped.inject).toEqual(['tools', 'vision', 'systemPrompt', 'fs'])
    expect(typeof unwrapped.apply).toBe('function')
  })

  it('boots over ctx.vision through the unwrapped module without an inject error', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem)
    await ctx.plugin(VisionRuntime, {})

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(toolVision) as Parameters<Context['plugin']>[0]
    const fiber = await ctx.plugin(unwrapped)
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('view_image')
    await fiber.dispose()
  })
})
