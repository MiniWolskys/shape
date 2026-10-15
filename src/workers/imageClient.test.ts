import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPainting } from '../domain/library.ts'
import { createRaster } from '../imaging/raster.ts'
import { decodePng } from '../packs/png.ts'
import { encodePngOffThread, requestThumbnail, resetImageWorker } from './imageClient.ts'
import { runImageJob } from './imageJobs.ts'
import type { ImageReply, ImageRequest } from './imageProtocol.ts'

const now = new Date('2026-10-15T12:00:00Z')

/** A Worker stand-in that does the job a moment later, as the image worker would. */
function fakeWorker(received: ImageRequest[], options: { crash?: boolean } = {}) {
  return class {
    onmessage: ((event: { data: ImageReply }) => void) | null = null
    onerror: ((event: { message: string }) => void) | null = null
    postMessage(request: ImageRequest) {
      received.push(request)
      setTimeout(() => {
        if (options.crash) this.onerror?.({ message: 'out of memory' })
        else this.onmessage?.({ data: runImageJob(request) })
      }, 0)
    }
    terminate() {}
  }
}

describe('image worker client (R39)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetImageWorker()
  })

  it('encodes a picture in the worker', async () => {
    const received: ImageRequest[] = []
    vi.stubGlobal('Worker', fakeWorker(received))
    const raster = createRaster(3, 2, [10, 20, 30, 255])
    const bytes = await encodePngOffThread(raster)
    expect(received.map((r) => r.kind)).toEqual(['encode'])
    expect(Array.from(decodePng(bytes).data)).toEqual(Array.from(raster.data))
  })

  it('renders a thumbnail in the worker, sending only the assets it needs', async () => {
    const received: ImageRequest[] = []
    vi.stubGlobal('Worker', fakeWorker(received))
    const p = createPainting({ width: 2, height: 1, pixelsPerBlock: 32 }, now, () => 0.5)
    const result = await new Promise((resolve) =>
      requestThumbnail(p, { unrelated: new Uint8Array([1]) }, resolve),
    )
    expect(result).toMatchObject({ width: 32, height: 16 })
    const request = received[0]
    expect(request?.kind === 'thumbnail' && request.assets).toEqual({})
  })

  it('works on the page when the worker stops', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('Worker', fakeWorker([], { crash: true }))
    const bytes = await encodePngOffThread(createRaster(1, 1, [1, 2, 3, 4]))
    expect(Array.from(decodePng(bytes).data)).toEqual([1, 2, 3, 4])
    expect(console.error).toHaveBeenCalled()
  })

  it('works on the page, at once, without workers', () => {
    vi.stubGlobal('Worker', undefined)
    const p = createPainting({ width: 1, height: 1, pixelsPerBlock: 16 }, now, () => 0.5)
    let result: unknown = null
    requestThumbnail(p, {}, (r) => {
      result = r
    })
    expect(result).toMatchObject({ width: 16, height: 16 })
  })
})
