import type { FrameMaterial, ShapeId } from '../domain/types.ts'
import { FRAME_MATERIALS, LEAD_COLOR } from './materials.ts'
import { cloneRaster, createRaster, type Raster, type RGB } from './raster.ts'
import { makeShapeContext, SHAPES } from './shapes.ts'

const LIGHT_WOOD: RGB = [214, 190, 150]
const RIVET_COLOR: RGB = [150, 120, 90]
const PAPER_COLOR: RGB = [244, 236, 214]

/**
 * Cuts the picture into a window shape: `out` pixels become transparent (RGB = frame colour),
 * the frame and bars are opaque material colour with a deterministic grain, leads are dark,
 * and glass shows the picture at `glassOpacity`. Thickness 0 or material `none` drops the
 * outer frame.
 */
export function applyWindow(
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
  const classify = SHAPES[o.shape]
  const { color: frameRGB, grain } = FRAME_MATERIALS[o.material]
  const [fr, fg, fb] = frameRGB
  const opacity = Math.min(1, Math.max(0, o.glassOpacity))
  const src = picture.data
  const out = createRaster(w, h)
  const dst = out.data

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const c = classify(x + 0.5, y + 0.5, ctx)
      let r: number
      let g: number
      let b: number
      let a = 255
      if (c.kind === 'out') {
        r = fr
        g = fg
        b = fb
        a = 0
      } else if (c.kind === 'frame') {
        if (c.rivet) [r, g, b] = RIVET_COLOR
        else if (c.light) [r, g, b] = LIGHT_WOOD
        else {
          const shift = (((y * 5 + Math.floor(x / 3)) % 7) - 3) * grain
          r = fr + shift
          g = fg + shift
          b = fb + shift
        }
      } else if (c.kind === 'lead') {
        ;[r, g, b] = LEAD_COLOR
      } else {
        r = src[i] ?? 0
        g = src[i + 1] ?? 0
        b = src[i + 2] ?? 0
        a = src[i + 3] ?? 0
        if (c.tint) {
          r = (r + c.tint[0]) / 2
          g = (g + c.tint[1]) / 2
          b = (b + c.tint[2]) / 2
          a *= 0.92
        }
        if (c.paper) {
          r += (PAPER_COLOR[0] - r) * 0.7
          g += (PAPER_COLOR[1] - g) * 0.7
          b += (PAPER_COLOR[2] - b) * 0.7
          a *= 0.88
        }
        a = Math.round(a * opacity)
      }
      dst[i] = r
      dst[i + 1] = g
      dst[i + 2] = b
      dst[i + 3] = a
    }
  }
  return out
}

/** How the painting looks without the mod: every pixel fully opaque. */
export function withoutMod(r: Raster): Raster {
  const out = cloneRaster(r)
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255
  return out
}

/** Share of the painting that is see-through, 0..1. */
export function transparentShare(r: Raster): number {
  const pixels = r.width * r.height
  if (pixels === 0) return 0
  let sum = 0
  for (let i = 3; i < r.data.length; i += 4) sum += 1 - (r.data[i] ?? 0) / 255
  return sum / pixels
}
