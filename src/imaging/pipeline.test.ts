import { describe, expect, it } from 'vitest'
import { createPainting } from '../domain/library.ts'
import type { Painting } from '../domain/types.ts'
import { createEditLayer } from './edits.ts'
import { renderPainting, renderPicture } from './pipeline.ts'
import { createRaster, getPixel, setPixel } from './raster.ts'

const painting = (patch: Partial<Painting> = {}): Painting => ({
  ...createPainting({ title: 'Test', pixelsPerBlock: 16 }, new Date(0), () => 0.5),
  ...patch,
})

describe('pipeline', () => {
  it('renders a full painting with a dark oak frame', () => {
    const out = renderPainting(createRaster(40, 20, [255, 0, 0, 255]), null, painting())
    expect([out.width, out.height]).toEqual([16, 16])
    expect(getPixel(out, 8, 8)).toEqual([255, 0, 0, 255])
    const [r, g, b, a] = getPixel(out, 0, 8)
    expect(Math.abs(r - 74)).toBeLessThanOrEqual(16)
    expect(Math.abs(g - 47)).toBeLessThanOrEqual(16)
    expect(Math.abs(b - 28)).toBeLessThanOrEqual(16)
    expect(a).toBe(255)
  })
  it('uses a grey checker placeholder without a source', () => {
    const out = renderPicture(null, painting({ width: 2, height: 1 }))
    expect([out.width, out.height]).toEqual([32, 16])
    expect(getPixel(out, 0, 0)).toEqual([110, 110, 114, 255])
    expect(getPixel(out, 4, 0)).toEqual([92, 92, 96, 255])
    expect(getPixel(out, 4, 4)).toEqual([110, 110, 114, 255])
  })
  it('honours an explicit crop after rotation', () => {
    const src = createRaster(20, 10, [0, 0, 255, 255])
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) setPixel(src, x, y, [0, 255, 0, 255])
    const p = painting()
    const left = renderPicture(src, {
      ...p,
      recipe: { ...p.recipe, crop: { x: 0, y: 0, width: 10, height: 10 } },
    })
    expect(getPixel(left, 8, 8)).toEqual([0, 255, 0, 255])
    // Rotated 90° clockwise the green half ends up on top, so the bottom square is blue.
    const rotated = renderPicture(src, {
      ...p,
      recipe: { ...p.recipe, rotation: 90, crop: { x: 0, y: 10, width: 10, height: 10 } },
    })
    expect(getPixel(rotated, 8, 8)).toEqual([0, 0, 255, 255])
  })
  it('applies the Minecraft look when enabled', () => {
    const src = createRaster(16, 16)
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) setPixel(src, x, y, [x * 16, y * 16, 128, 255])
    const p = painting()
    const out = renderPicture(src, {
      ...p,
      recipe: { ...p.recipe, mcLook: { enabled: true, colors: 2, palette: 'auto', dither: false } },
    })
    const seen = new Set<string>()
    for (let i = 0; i < out.data.length; i += 4)
      seen.add(`${out.data[i]},${out.data[i + 1]},${out.data[i + 2]}`)
    expect(seen.size).toBeLessThanOrEqual(2)
  })
  it('applies edits on top of the window, rescaling them to the painting', () => {
    const edits = createEditLayer(8, 8)
    setPixel(edits.values, 4, 4, [0, 0, 0, 0])
    edits.mask[4 * 8 + 4] = 1
    const out = renderPainting(createRaster(16, 16, [255, 0, 0, 255]), edits, painting())
    expect(getPixel(out, 8, 8)).toEqual([0, 0, 0, 0])
    expect(getPixel(out, 6, 6)).toEqual([255, 0, 0, 255])
  })
  it('is deterministic for a given painting', () => {
    const p = painting()
    const src = createRaster(16, 16, [10, 200, 30, 255])
    const shaped: Painting = {
      ...p,
      recipe: { ...p.recipe, window: { shape: 'stained_glass', glassOpacity: 1 } },
    }
    expect(renderPainting(src, null, shaped).data).toEqual(renderPainting(src, null, shaped).data)
  })
})
