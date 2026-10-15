import { describe, expect, it } from 'vitest'
import { createRaster, getPixel, setPixel } from './raster.ts'
import { resample } from './resample.ts'

describe('resample', () => {
  it('sharp upscale duplicates each pixel', () => {
    const r = createRaster(2, 2)
    setPixel(r, 0, 0, [1, 0, 0, 255])
    setPixel(r, 1, 0, [2, 0, 0, 255])
    setPixel(r, 0, 1, [3, 0, 0, 255])
    setPixel(r, 1, 1, [4, 0, 0, 255])
    const o = resample(r, 4, 4, 'sharp')
    expect([o.width, o.height]).toEqual([4, 4])
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) expect(getPixel(o, x, y)[0]).toBe(1 + (x >> 1) + 2 * (y >> 1))
  })
  it('smooth averages black and white to grey', () => {
    const r = createRaster(2, 1)
    setPixel(r, 0, 0, [0, 0, 0, 255])
    setPixel(r, 1, 0, [255, 255, 255, 255])
    const [red, green, blue, alpha] = getPixel(resample(r, 1, 1, 'smooth'), 0, 0)
    for (const c of [red, green, blue]) expect(Math.abs(c - 128)).toBeLessThanOrEqual(1)
    expect(alpha).toBe(255)
  })
  it('smooth ignores the colour of fully transparent pixels', () => {
    const r = createRaster(2, 1)
    setPixel(r, 0, 0, [255, 0, 0, 0])
    setPixel(r, 1, 0, [0, 0, 255, 255])
    const o = resample(r, 1, 1, 'smooth')
    expect(Array.from(getPixel(o, 0, 0))).toEqual([0, 0, 255, 128])
  })
  it('smooth of only transparent pixels is transparent black', () => {
    const r = createRaster(2, 2, [9, 9, 9, 0])
    expect(Array.from(getPixel(resample(r, 1, 1, 'smooth'), 0, 0))).toEqual([0, 0, 0, 0])
  })
  it('smooth upscale falls back to the nearest pixel', () => {
    const r = createRaster(1, 1, [10, 20, 30, 255])
    const o = resample(r, 3, 3, 'smooth')
    expect(Array.from(getPixel(o, 2, 2))).toEqual([10, 20, 30, 255])
  })
  it('sharp downscale samples pixel centres', () => {
    const r = createRaster(4, 1)
    for (let x = 0; x < 4; x++) setPixel(r, x, 0, [x, 0, 0, 255])
    const o = resample(r, 2, 1, 'sharp')
    expect([getPixel(o, 0, 0)[0], getPixel(o, 1, 0)[0]]).toEqual([1, 3])
  })
  it('rejects empty targets', () => {
    expect(() => resample(createRaster(2, 2), 0, 2, 'sharp')).toThrow(RangeError)
    expect(() => resample(createRaster(2, 2), 2, 0, 'smooth')).toThrow(RangeError)
  })
})
