import { describe, expect, it } from 'vitest'
import { frameLuminance } from './materials.ts'
import { createRaster, getPixel } from './raster.ts'
import { applyWindow, transparentShare, withoutMod } from './window.ts'

const pic = () => createRaster(32, 32, [200, 100, 50, 255])
const base = {
  glassOpacity: 1,
  material: 'dark_oak' as const,
  thickness: 2,
  pixelsPerBlock: 32,
  seed: 1,
}

describe('applyWindow', () => {
  it('oculus makes corners transparent with frame-coloured RGB', () => {
    const r = applyWindow(pic(), { ...base, shape: 'oculus' })
    expect(getPixel(r, 0, 0)).toEqual([74, 47, 28, 0])
    expect(getPixel(r, 16, 16)).toEqual([200, 100, 50, 255])
  })
  it('glass opacity lowers alpha inside', () =>
    expect(
      getPixel(applyWindow(pic(), { ...base, shape: 'full', glassOpacity: 0.5 }), 16, 16)[3],
    ).toBe(128))
  it('full painting with no frame is unchanged', () => {
    const r = applyWindow(pic(), { ...base, shape: 'full', material: 'none' })
    expect(r.data).toEqual(pic().data)
  })
  it('thickness 0 also removes the frame', () => {
    const r = applyWindow(pic(), { ...base, shape: 'full', thickness: 0 })
    expect(r.data).toEqual(pic().data)
  })
  it('is deterministic', () =>
    expect(applyWindow(pic(), { ...base, shape: 'stained_glass' }).data).toEqual(
      applyWindow(pic(), { ...base, shape: 'stained_glass' }).data,
    ))
  it('frames are opaque material colour with mild grain', () => {
    const r = applyWindow(pic(), { ...base, shape: 'full', material: 'oak' })
    const [red, green, blue, a] = getPixel(r, 0, 16)
    expect(a).toBe(255)
    expect(Math.abs(red - 160)).toBeLessThanOrEqual(9)
    expect(Math.abs(green - 120)).toBeLessThanOrEqual(9)
    expect(Math.abs(blue - 72)).toBeLessThanOrEqual(9)
  })
  it('tinted panes mix the colour and lower alpha', () => {
    const r = applyWindow(pic(), { ...base, shape: 'stained_glass' })
    let tinted = 0
    for (let i = 3; i < r.data.length; i += 4) if (r.data[i] === 235) tinted++
    expect(tinted).toBeGreaterThan(0)
  })
  it('withoutMod is fully opaque and transparentShare measures cut-outs', () => {
    const r = applyWindow(pic(), { ...base, shape: 'oculus' })
    expect(transparentShare(r)).toBeGreaterThan(0.15)
    expect(transparentShare(withoutMod(r))).toBe(0)
  })
  it('frame luminance tells dark frames from light ones', () => {
    expect(frameLuminance('dark_oak')).toBeCloseTo((0.2126 * 74 + 0.7152 * 47 + 0.0722 * 28) / 255)
    expect(frameLuminance('birch')).toBeGreaterThan(0.45)
    expect(frameLuminance('spruce')).toBeLessThan(0.45)
  })
  it('shapes a 1024x1024 stained-glass painting well under a second', () => {
    const big = createRaster(1024, 1024, [200, 100, 50, 255])
    const start = performance.now()
    applyWindow(big, { ...base, shape: 'stained_glass', pixelsPerBlock: 64 })
    expect(performance.now() - start).toBeLessThan(1000)
  })
})
