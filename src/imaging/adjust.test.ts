import { describe, expect, it } from 'vitest'
import { adjust } from './adjust.ts'
import { createRaster, getPixel } from './raster.ts'

const zero = { brightness: 0, contrast: 0, saturation: 0 }

describe('adjust', () => {
  it('all zeros gives an identical copy', () => {
    const r = createRaster(2, 2, [12, 200, 77, 190])
    const o = adjust(r, zero)
    expect(o).not.toBe(r)
    expect(o.data).toEqual(r.data)
  })
  it('brightness 100 turns 100 into 255', () => {
    const o = adjust(createRaster(1, 1, [100, 100, 100, 255]), { ...zero, brightness: 100 })
    expect(Array.from(getPixel(o, 0, 0))).toEqual([255, 255, 255, 255])
  })
  it('negative brightness darkens and clamps at 0', () => {
    const o = adjust(createRaster(1, 1, [100, 100, 100, 255]), { ...zero, brightness: -100 })
    expect(Array.from(getPixel(o, 0, 0))).toEqual([0, 0, 0, 255])
  })
  it('contrast pushes values away from mid grey', () => {
    const o = adjust(createRaster(1, 1, [200, 50, 128, 255]), { ...zero, contrast: 50 })
    const [r, g, b] = getPixel(o, 0, 0)
    expect(r).toBeGreaterThan(200)
    expect(g).toBeLessThan(50)
    expect(b).toBe(128)
  })
  it('saturation -100 gives grey', () => {
    const o = adjust(createRaster(1, 1, [200, 50, 10, 255]), { ...zero, saturation: -100 })
    const [r, g, b] = getPixel(o, 0, 0)
    expect(r).toBe(g)
    expect(g).toBe(b)
  })
  it('saturation +100 increases colourfulness', () => {
    const o = adjust(createRaster(1, 1, [200, 100, 100, 255]), { ...zero, saturation: 100 })
    const [r, g] = getPixel(o, 0, 0)
    expect(r - g).toBeGreaterThan(100)
  })
  it('leaves alpha untouched', () => {
    const o = adjust(createRaster(1, 1, [100, 100, 100, 77]), {
      brightness: 50,
      contrast: 30,
      saturation: -40,
    })
    expect(getPixel(o, 0, 0)[3]).toBe(77)
  })
})
