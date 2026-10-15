import { describe, expect, it } from 'vitest'
import { FRAME_MATERIAL_IDS, SHAPE_IDS, type FrameMaterial, type ShapeId } from '../domain/types.ts'
import { FRAME_MATERIALS, frameLuminance, LEAD_COLOR } from './materials.ts'
import { createRaster, getPixel, setPixel, type Raster } from './raster.ts'
import { makeShapeContext, SHAPES } from './shapes.ts'
import {
  applyWindow,
  classifyShape,
  FRAME_BOUND,
  paintWindow,
  reframeShape,
  shapeEdge,
  transparentShare,
  withoutMod,
} from './window.ts'

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
  it('coarse performance guard: shapes 1024x1024 stained glass in under 5 s', () => {
    const big = createRaster(1024, 1024, [200, 100, 50, 255])
    const start = performance.now()
    applyWindow(big, { ...base, shape: 'stained_glass', pixelsPerBlock: 64 })
    expect(performance.now() - start).toBeLessThan(5000)
  })
})

/** applyWindow as it was before it was split into classify + paint: the oracle. */
function referenceWindow(
  picture: Raster,
  o: {
    shape: ShapeId
    glassOpacity: number
    material: FrameMaterial
    thickness: number
    pixelsPerBlock: number
    seed: number
  },
): Raster {
  const { width: w, height: h } = picture
  const frame = o.material === 'none' ? 0 : o.thickness
  const ctx = makeShapeContext(w, h, o.pixelsPerBlock, frame, o.seed)
  const { color, grain } = FRAME_MATERIALS[o.material]
  const opacity = Math.min(1, Math.max(0, o.glassOpacity))
  const out = createRaster(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const c = SHAPES[o.shape](x + 0.5, y + 0.5, ctx)
      let [r, g, b, a] = [0, 0, 0, 255]
      if (c.kind === 'out') [r, g, b, a] = [...color, 0]
      else if (c.kind === 'frame') {
        if (c.rivet) [r, g, b] = [150, 120, 90]
        else if (c.light) [r, g, b] = [214, 190, 150]
        else {
          const shift = (((y * 5 + Math.floor(x / 3)) % 7) - 3) * grain
          ;[r, g, b] = [color[0] + shift, color[1] + shift, color[2] + shift]
        }
      } else if (c.kind === 'lead') [r, g, b] = LEAD_COLOR
      else {
        ;[r, g, b, a] = [...picture.data.subarray(i, i + 4)] as [number, number, number, number]
        if (c.tint) {
          ;[r, g, b] = [(r + c.tint[0]) / 2, (g + c.tint[1]) / 2, (b + c.tint[2]) / 2]
          a *= 0.92
        }
        if (c.paper) {
          r += (244 - r) * 0.7
          g += (236 - g) * 0.7
          b += (214 - b) * 0.7
          a *= 0.88
        }
        a = Math.round(a * opacity)
      }
      out.data.set([r, g, b, a], i)
    }
  }
  return out
}

/** Index of the first differing element, or -1 (much faster than a deep equal on big arrays). */
function firstDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return Math.min(a.length, b.length)
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i
  return -1
}

describe('shape maps', () => {
  const picture = createRaster(48, 32)
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 48; x++) setPixel(picture, x, y, [x * 5, y * 7, 90, 200 + (x % 50)])

  it('classify then paint gives what applyWindow always gave', () => {
    for (const shape of SHAPE_IDS) {
      for (const material of FRAME_MATERIAL_IDS) {
        for (const [glassOpacity, thickness] of [
          [1, 2],
          [0.37, 5],
          [0, 0],
        ] as const) {
          const o = { shape, material, glassOpacity, thickness, pixelsPerBlock: 16, seed: 9 }
          const expected = referenceWindow(picture, o).data
          expect(
            firstDifference(applyWindow(picture, o).data, expected),
            `${shape} ${material}`,
          ).toBe(-1)
        }
      }
    }
  })

  it('paints any glass and material over one classification', () => {
    const map = classifyShape(48, 32, { shape: 'rose', frame: 3, pixelsPerBlock: 16, seed: 4 })
    for (const material of ['oak', 'iron'] as const) {
      const o = {
        shape: 'rose' as const,
        material,
        glassOpacity: 0.6,
        thickness: 3,
        pixelsPerBlock: 16,
        seed: 4,
      }
      expect(paintWindow(picture, map, o).data).toEqual(referenceWindow(picture, o).data)
    }
  })

  it('reframes a frameless classification exactly, for every thickness up to the bound', () => {
    for (const shape of SHAPE_IDS) {
      for (const [w, h, ppb, seed] of [
        [48, 32, 16, 9],
        [40, 40, 8, 2],
      ] as const) {
        const o = { shape, pixelsPerBlock: ppb, seed }
        const zero = classifyShape(w, h, { ...o, frame: 0 })
        const edge = shapeEdge(zero, classifyShape(w, h, { ...o, frame: FRAME_BOUND }))
        for (let frame = 0; frame <= FRAME_BOUND; frame++) {
          const direct = classifyShape(w, h, { ...o, frame })
          const reframed = reframeShape(zero, edge, { ...o, frame }).codes
          expect(firstDifference(reframed, direct.codes), `${shape} ${frame}`).toBe(-1)
        }
      }
    }
  })
})
