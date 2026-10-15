import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShapeError } from '../domain/errors.ts'
import { fileToRaster } from './decode.ts'

function stubDecoder(width: number, height: number) {
  const close = vi.fn()
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => Promise.resolve({ width, height, close })),
  )
  class FakeCanvas {
    readonly width: number
    readonly height: number
    constructor(width: number, height: number) {
      this.width = width
      this.height = height
    }
    getContext() {
      const { width: w, height: h } = this
      return {
        drawImage: vi.fn(),
        getImageData: () => ({ data: new Uint8ClampedArray(w * h * 4).fill(200) }),
      }
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
  return close
}

describe('fileToRaster', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('decodes a picture into a raster and releases the bitmap', async () => {
    const close = stubDecoder(4, 3)
    const raster = await fileToRaster(new File(['x'], 'a.png', { type: 'image/png' }))
    expect([raster.width, raster.height]).toEqual([4, 3])
    expect(raster.data[0]).toBe(200)
    expect(close).toHaveBeenCalled()
  })

  it('shrinks pictures larger than 2048 pixels', async () => {
    stubDecoder(2560, 640)
    const raster = await fileToRaster(new File(['x'], 'big.png', { type: 'image/png' }))
    expect([raster.width, raster.height]).toEqual([2048, 512])
  })

  it('reports anything it cannot decode as not-an-image', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new DOMException('bad', 'InvalidStateError'))),
    )
    const result = fileToRaster(new File(['nope'], 'notes.txt', { type: 'text/plain' }))
    await expect(result).rejects.toBeInstanceOf(ShapeError)
    await expect(result).rejects.toMatchObject({ code: 'not-an-image' })
  })
})
