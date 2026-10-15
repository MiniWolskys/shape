import { describe, expect, it } from 'vitest'
import { createRaster, getPixel, setPixel } from './raster.ts'
import { centeredCrop, crop, fitWithin, flip, rotate } from './transform.ts'

const grid = () => {
  const r = createRaster(2, 3)
  let v = 0
  for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) setPixel(r, x, y, [v++, 0, 0, 255])
  return r
}

describe('transform', () => {
  it('rotates 90° clockwise', () => {
    const r = rotate(grid(), 90)
    expect([r.width, r.height]).toEqual([3, 2])
    expect(getPixel(r, 0, 0)[0]).toBe(4) // bottom-left becomes top-left
    expect(getPixel(r, 2, 0)[0]).toBe(0)
  })
  it('rotates 180° and 270°', () => {
    const r180 = rotate(grid(), 180)
    expect([r180.width, r180.height, getPixel(r180, 0, 0)[0]]).toEqual([2, 3, 5])
    const r270 = rotate(grid(), 270)
    expect([r270.width, r270.height]).toEqual([3, 2])
    expect(getPixel(r270, 0, 0)[0]).toBe(1) // top-right becomes top-left
    expect(getPixel(r270, 2, 1)[0]).toBe(4)
  })
  it('rotating by 0 returns an equal copy', () => {
    const g = grid()
    const r = rotate(g, 0)
    expect(r).not.toBe(g)
    expect(r.data).toEqual(g.data)
  })
  it('rotating four times is identity', () => {
    const g = grid()
    let r = g
    for (let i = 0; i < 4; i++) r = rotate(r, 90)
    expect(r.data).toEqual(g.data)
  })
  it('flips horizontally', () => expect(getPixel(flip(grid(), true, false), 0, 0)[0]).toBe(1))
  it('flips vertically and both', () => {
    expect(getPixel(flip(grid(), false, true), 0, 0)[0]).toBe(4)
    expect(getPixel(flip(grid(), true, true), 0, 0)[0]).toBe(5)
    expect(flip(grid(), false, false).data).toEqual(grid().data)
  })
  it('crops and clamps', () => {
    const r = crop(grid(), { x: 1, y: 1, width: 5, height: 1 })
    expect([r.width, r.height, getPixel(r, 0, 0)[0]]).toEqual([1, 1, 3])
  })
  it('clamps negative origins', () => {
    const r = crop(grid(), { x: -1, y: -1, width: 2, height: 2 })
    expect([r.width, r.height, getPixel(r, 0, 0)[0]]).toEqual([1, 1, 0])
  })
  it('throws when the crop is outside the raster', () => {
    expect(() => crop(grid(), { x: 5, y: 0, width: 2, height: 2 })).toThrow(RangeError)
  })
  it('fits huge images within a limit', () => {
    const r = fitWithin(createRaster(8000, 6000), 2048)
    expect([r.width, r.height]).toEqual([2048, 1536])
  })
  it('keeps a 1x1 image as is', () => expect(fitWithin(createRaster(1, 1), 2048).width).toBe(1))
  it('returns a copy when no resize is needed', () => {
    const g = grid()
    const r = fitWithin(g, 2048)
    expect(r).not.toBe(g)
    expect(r.data).toEqual(g.data)
  })
  it('computes the largest centred crop for a ratio', () =>
    expect(centeredCrop(400, 300, 2, 1)).toEqual({ x: 0, y: 50, width: 400, height: 200 }))
  it('centres a crop that is limited by height', () =>
    expect(centeredCrop(400, 300, 1, 1)).toEqual({ x: 50, y: 0, width: 300, height: 300 }))
})
