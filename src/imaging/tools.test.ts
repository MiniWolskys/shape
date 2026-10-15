import { describe, expect, it } from 'vitest'
import { createEditLayer } from './edits.ts'
import { createRaster, getPixel, setPixel } from './raster.ts'
import { colorDistance, eyedropper, maskSize, paintMask, pencil, selectSimilar } from './tools.ts'

function wallImage() {
  // 3x3: columns 0 and 2 white, column 1 black
  const r = createRaster(3, 3, [255, 255, 255, 255])
  for (let y = 0; y < 3; y++) setPixel(r, 1, y, [0, 0, 0, 255])
  return r
}

describe('selectSimilar', () => {
  it('contiguous fill stays on its side of the wall', () => {
    const m = selectSimilar(wallImage(), 0, 0, 0, true)
    expect(Array.from(m)).toEqual([1, 0, 0, 1, 0, 0, 1, 0, 0])
  })
  it('non-contiguous selects both sides', () => {
    const m = selectSimilar(wallImage(), 0, 0, 0, false)
    expect(Array.from(m)).toEqual([1, 0, 1, 1, 0, 1, 1, 0, 1])
  })
  it('respects tolerance', () => {
    const r = createRaster(2, 1, [100, 100, 100, 255])
    setPixel(r, 1, 0, [105, 100, 100, 255])
    expect(maskSize(selectSimilar(r, 0, 0, 0, true))).toBe(1)
    expect(maskSize(selectSimilar(r, 0, 0, 10, true))).toBe(2)
  })
  it('returns an empty mask for an out-of-bounds start', () => {
    const m = selectSimilar(wallImage(), 5, 0, 10, true)
    expect(m.length).toBe(9)
    expect(maskSize(m)).toBe(0)
  })
  it('fills a 1024x1024 uniform image without overflowing the stack', () => {
    const r = createRaster(1024, 1024, [10, 20, 30, 255])
    expect(maskSize(selectSimilar(r, 500, 500, 0, true))).toBe(1_048_576)
  })
})

describe('colorDistance', () => {
  it('is the max channel difference including alpha', () => {
    expect(colorDistance([0, 0, 0, 255], [10, 3, 0, 255])).toBe(10)
    expect(colorDistance([0, 0, 0, 255], [0, 0, 0, 0])).toBe(255)
  })
})

describe('editing tools', () => {
  it('pencil draws a diagonal and ignores out-of-bounds points', () => {
    const layer = createEditLayer(4, 4)
    const out = pencil(
      layer,
      [
        [0, 0],
        [3, 3],
        [9, 9],
      ],
      [1, 2, 3, 255],
    )
    expect(maskSize(out.mask)).toBe(4)
    expect(getPixel(out.values, 2, 2)).toEqual([1, 2, 3, 255])
    expect(maskSize(layer.mask)).toBe(0)
  })
  it('pencil with a single point paints that pixel', () => {
    const out = pencil(createEditLayer(3, 3), [[1, 1]], [9, 9, 9, 255])
    expect(maskSize(out.mask)).toBe(1)
  })
  it('paintMask returns a new layer', () => {
    const layer = createEditLayer(2, 1)
    const out = paintMask(layer, Uint8Array.from([0, 1]), [5, 6, 7, 255])
    expect(out).not.toBe(layer)
    expect(Array.from(out.mask)).toEqual([0, 1])
    expect(getPixel(out.values, 1, 0)).toEqual([5, 6, 7, 255])
    expect(maskSize(layer.mask)).toBe(0)
  })
  it('pencil ignores non-finite points and stays fast on huge coordinates', () => {
    const layer = createEditLayer(4, 4)
    const nan = pencil(
      layer,
      [
        [NaN, 1],
        [1, Infinity],
        [-Infinity, 0],
      ],
      [1, 1, 1, 255],
    )
    expect(maskSize(nan.mask)).toBe(0)
    const start = Date.now()
    const far = pencil(
      layer,
      [
        [0, 0],
        [1e9, 1e9],
      ],
      [1, 1, 1, 255],
    )
    expect(Date.now() - start).toBeLessThan(500)
    expect(maskSize(far.mask)).toBe(4)
    const across = pencil(
      layer,
      [
        [-1e9, 1],
        [1e9, 1],
      ],
      [1, 1, 1, 255],
    )
    expect(maskSize(across.mask)).toBe(4)
  })
  it('eyedropper clamps out-of-bounds coordinates', () => {
    const r = wallImage()
    expect(eyedropper(r, -1, 1)).toEqual(getPixel(r, 0, 1))
    expect(eyedropper(r, 9, 9)).toEqual(getPixel(r, 2, 2))
    expect(eyedropper(r, 1.7, 0.2)).toEqual(getPixel(r, 1, 0))
  })
  it('eyedropper reads a pixel', () => {
    expect(eyedropper(wallImage(), 1, 1)).toEqual([0, 0, 0, 255])
  })
})
