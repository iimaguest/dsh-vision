/**
 * Real HTTP coverage proves whether native `fetch` contacts a cross-origin `Location`; mocked
 * request-init assertions alone cannot observe that boundary.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import { DeepSeekViewProvider } from '@deepseek-ai/dsh-vision-deepseek'
import type { DeepSeekViewProviderOptions } from '@deepseek-ai/dsh-vision-deepseek'

const viewProvider = (options: DeepSeekViewProviderOptions): DeepSeekViewProvider =>
  new DeepSeekViewProvider(() => options)

const TEST_API_KEY = 'redirect-test-key'
const targetRequests: ReceivedRequest[] = []

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

interface ReceivedRequest {
  readonly body: string
  readonly headers: IncomingMessage['headers']
  readonly method?: string
}

let redirectOrigin: string
let targetOrigin: string

const targetServer = createServer((request, response) => {
  void captureRequest(request).then((received) => {
    targetRequests.push(received)
    response.writeHead(204).end()
  }, (error: unknown) => response.destroy(asError(error)))
})

const redirectServer = createServer((request, response) => {
  request.resume()
  const status = Number(new URL(request.url ?? '/', 'http://fixture.test').pathname.split('/')[1])
  response.writeHead(status, { location: `${targetOrigin}/collect` }).end()
})

beforeAll(async () => {
  targetOrigin = await listen(targetServer)
  redirectOrigin = await listen(redirectServer)
})

afterAll(async () => {
  await Promise.all([close(redirectServer), close(targetServer)])
})

describe('DeepSeekViewProvider redirect policy', () => {
  it.each([301, 302, 303, 307, 308])('rejects HTTP %i before contacting Location', async (status) => {
    targetRequests.length = 0
    const provider = viewProvider({
      apiKey: TEST_API_KEY,
      baseURL: `${redirectOrigin}/${status}`,
      model: 'deepseek-v4-flash-vision-exp',
      maxTokens: 32,
      imagePixelBudget: 640_000,
      imageMaxBytes: 1024,
      resolveAttachments: () => ({
        readImageRequest: () => Promise.resolve(requestVersion),
      } as unknown as AttachmentStore),
    })

    await expect(provider.view({ attachment, prompt: 'q' }))
      .rejects.toMatchObject({ code: 'VISION_PROVIDER_ERROR' })
    expect(targetRequests).toHaveLength(0)
  })

  it('shows default 307 following forwards the custom credential and POST body', async () => {
    targetRequests.length = 0
    const body = JSON.stringify({ prompt: 'q' })
    await fetch(`${redirectOrigin}/307`, {
      method: 'POST',
      headers: {
        'x-api-key': TEST_API_KEY,
        'authorization': `Bearer ${TEST_API_KEY}`,
        'content-type': 'application/json',
      },
      body,
    })

    expect(targetRequests).toHaveLength(1)
    expect(targetRequests[0]).toMatchObject({ method: 'POST', body })
    expect(targetRequests[0]?.headers['x-api-key']).toBe(TEST_API_KEY)
  })
})

/** Read a complete request received by the redirect target. */
function captureRequest(request: IncomingMessage): Promise<ReceivedRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    request.on('data', (chunk: unknown) => {
      if (typeof chunk === 'string' || chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk))
      else reject(new TypeError('unexpected HTTP request chunk'))
    })
    request.once('error', reject)
    request.once('end', () => {
      resolve({
        ...request.method !== undefined ? { method: request.method } : {},
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
    })
  })
}

/** Listen on an ephemeral loopback port and return the server origin. */
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

/** Close a listening fixture server after every request has settled. */
async function close(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error === undefined) resolve()
    else reject(error)
  }))
}

/** Normalize an unknown fixture failure for `ServerResponse.destroy`. */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
