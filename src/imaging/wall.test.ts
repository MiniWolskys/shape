import { describe, expect, it } from 'vitest'
import { createRaster, getPixel } from './raster.ts'
import { compositeOver, renderStoneWall, renderWallPreview } from './wall.ts'

describe('renderStoneWall', () => {
  it('is sized by blocks and fully opaque', () => {
    const w = renderStoneWall(2, 1, 16)
    expect([w.width, w.height]).toEqual([32, 16])
    for (let i = 3; i < w.data.length; i += 4) expect(w.data[i]).toBe(255)
  })
  it('is deterministic', () => {
    expect(renderStoneWall(2, 2, 16).data).toEqual(renderStoneWall(2, 2, 16).data)
  })
  it('handles small pixel densities', () => {
    const w = renderStoneWall(1, 1, 4)
    expect([w.width, w.height]).toEqual([4, 4])
  })
})

describe('compositeOver', () => {
  it('blends half-transparent white over black to about 128', () => {
    const dst = createRaster(1, 1, [0, 0, 0, 255])
    const src = createRaster(1, 1, [255, 255, 255, 128])
    const out = compositeOver(dst, src, 0, 0)
    expect(getPixel(out, 0, 0)[0]).toBeGreaterThanOrEqual(127)
    expect(getPixel(out, 0, 0)[0]).toBeLessThanOrEqual(129)
    expect(getPixel(dst, 0, 0)[0]).toBe(0)
  })
  it('clips sources that overhang', () => {
    const out = compositeOver(
      createRaster(2, 2, [0, 0, 0, 255]),
      createRaster(2, 2, [9, 9, 9, 255]),
      1,
      1,
    )
    expect(getPixel(out, 1, 1)[0]).toBe(9)
    expect(getPixel(out, 0, 0)[0]).toBe(0)
  })
})

describe('renderWallPreview', () => {
  it('adds margin and a reference slot', () => {
    const painting = createRaster(32, 16, [255, 0, 0, 255])
    const w = renderWallPreview(painting, 2, 1, 16)
    expect([w.width, w.height]).toEqual([96, 48])
    expect(getPixel(w, 16, 16)).toEqual([255, 0, 0, 255])
  })
  it('can omit the reference', () => {
    const painting = createRaster(16, 16, [255, 0, 0, 255])
    const w = renderWallPreview(painting, 1, 1, 16, { reference: false })
    expect([w.width, w.height]).toEqual([48, 48])
  })
  it('bottom-aligns the reference with the painting', () => {
    const painting = createRaster(16, 32, [255, 0, 0, 255])
    const w = renderWallPreview(painting, 1, 2, 16, { margin: 1 })
    // reference at block x=2, bottom row of painting is block y=2
    const ref = getPixel(w, 2 * 16 + 8, 2 * 16 + 8)
    expect(ref[3]).toBe(255)
    expect(ref).not.toEqual([255, 0, 0, 255])
  })
})
