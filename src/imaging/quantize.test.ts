import { describe, expect, it } from 'vitest'
import { createRaster, getPixel, setPixel, type Raster, type RGBA } from './raster.ts'
import { BLOCK_PALETTE, quantize } from './quantize.ts'

const FOUR: RGBA[] = [
  [250, 20, 20, 255],
  [20, 250, 20, 255],
  [20, 20, 250, 255],
  [240, 240, 240, 255],
]

function fourColours(): Raster {
  const r = createRaster(8, 8)
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) setPixel(r, x, y, FOUR[(x >> 2) + 2 * (y >> 2)] ?? [0, 0, 0, 0])
  return r
}

function opaqueColours(r: Raster): Set<string> {
  const seen = new Set<string>()
  for (let i = 0; i < r.data.length; i += 4)
    if ((r.data[i + 3] ?? 0) > 0) seen.add(`${r.data[i]},${r.data[i + 1]},${r.data[i + 2]}`)
  return seen
}

describe('quantize', () => {
  it('has a palette of at least 24 block colours', () =>
    expect(BLOCK_PALETTE.length).toBeGreaterThanOrEqual(24))
  it.each([false, true])('auto with 2 colours leaves at most 2 colours (dither %s)', (dither) => {
    const out = quantize(fourColours(), { colors: 2, palette: 'auto', dither })
    expect(opaqueColours(out).size).toBeLessThanOrEqual(2)
  })
  it('auto keeps every colour when there is room', () => {
    const out = quantize(fourColours(), { colors: 4, palette: 'auto', dither: false })
    expect(out.data).toEqual(fourColours().data)
  })
  it.each([false, true])('blocks only uses palette colours (dither %s)', (dither) => {
    const src = createRaster(16, 16)
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) setPixel(src, x, y, [x * 16, y * 16, (x * y) % 256, 255])
    const allowed = new Set(BLOCK_PALETTE.map((c) => c.join(',')))
    for (const c of opaqueColours(quantize(src, { colors: 16, palette: 'blocks', dither })))
      expect(allowed.has(c)).toBe(true)
  })
  it.each(['auto', 'blocks'] as const)('%s keeps transparent pixels and alpha', (palette) => {
    const src = fourColours()
    setPixel(src, 0, 0, [1, 2, 3, 0])
    setPixel(src, 7, 7, [240, 240, 240, 100])
    const out = quantize(src, { colors: 2, palette, dither: true })
    expect(getPixel(out, 0, 0)).toEqual([1, 2, 3, 0])
    expect(getPixel(out, 7, 7)[3]).toBe(100)
  })
})
