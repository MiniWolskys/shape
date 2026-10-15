import { describe, expect, it } from 'vitest'
import { createRaster, getPixel, setPixel } from './raster.ts'
import { applyEdits, createEditLayer, isEmptyLayer, resampleEdits } from './edits.ts'

describe('edit layer', () => {
  it('replaces only masked pixels, including with transparency', () => {
    const l = createEditLayer(2, 1)
    setPixel(l.values, 1, 0, [0, 0, 0, 0])
    l.mask[1] = 1
    const out = applyEdits(createRaster(2, 1, [9, 9, 9, 255]), l)
    expect([getPixel(out, 0, 0), getPixel(out, 1, 0)]).toEqual([
      [9, 9, 9, 255],
      [0, 0, 0, 0],
    ])
  })
  it('resampling keeps edits aligned when the resolution doubles', () => {
    const l = createEditLayer(2, 2)
    setPixel(l.values, 1, 1, [255, 0, 0, 255])
    l.mask[3] = 1
    const big = resampleEdits(l, 4, 4)
    expect(big.mask[3 * 4 + 3]).toBe(1)
    expect(big.mask[2 * 4 + 2]).toBe(1)
    expect(big.mask[0]).toBe(0)
    expect(getPixel(big.values, 3, 3)).toEqual([255, 0, 0, 255])
  })
  it('knows when a layer is empty', () => {
    const l = createEditLayer(3, 3)
    expect(isEmptyLayer(l)).toBe(true)
    l.mask[4] = 1
    expect(isEmptyLayer(l)).toBe(false)
  })
  it('refuses a layer of another size', () =>
    expect(() => applyEdits(createRaster(2, 2), createEditLayer(3, 3))).toThrow(RangeError))
})
