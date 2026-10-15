import { createRaster, type Raster } from './raster.ts'
import { renderScene } from './scenes.ts'
import { mulberry32 } from './shapes.ts'
import { applyWindow } from './window.ts'

const STONE_SEED = 42

/**
 * Procedural stone bricks, 16 texels per block (each texel is ppb/16 px, at least 1 px).
 * Deterministic: the same arguments always give the same pixels.
 */
export function renderStoneWall(blocksW: number, blocksH: number, pixelsPerBlock: number): Raster {
  const width = blocksW * pixelsPerBlock
  const height = blocksH * pixelsPerBlock
  const out = createRaster(width, height)
  const texel = Math.max(1, pixelsPerBlock / 16)
  const cols = Math.ceil(width / texel)
  const rows = Math.ceil(height / texel)
  const rand = mulberry32(STONE_SEED)
  const noise = new Int8Array(cols * rows)
  for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(rand() * 22) - 11

  for (let y = 0; y < height; y++) {
    const ty = Math.floor(y / texel)
    const ly = ty % 16
    const mortarH = ly === 7 || ly === 15
    const upper = ly < 8
    for (let x = 0; x < width; x++) {
      const tx = Math.floor(x / texel)
      const lx = tx % 16
      const mortarV = upper ? lx === 15 : lx === 7
      const v =
        mortarH || mortarV ? 86 : 118 + (noise[ty * cols + tx] ?? 0) + (ly % 8 === 0 ? 14 : 0)
      const i = (y * width + x) * 4
      out.data[i] = v
      out.data[i + 1] = v
      out.data[i + 2] = v + 2
      out.data[i + 3] = 255
    }
  }
  return out
}

/** Alpha-over of `src` onto a copy of `dst` at (x, y); parts outside `dst` are clipped. */
export function compositeOver(dst: Raster, src: Raster, x: number, y: number): Raster {
  const out: Raster = {
    width: dst.width,
    height: dst.height,
    data: new Uint8ClampedArray(dst.data),
  }
  for (let sy = 0; sy < src.height; sy++) {
    const dy = sy + y
    if (dy < 0 || dy >= dst.height) continue
    for (let sx = 0; sx < src.width; sx++) {
      const dx = sx + x
      if (dx < 0 || dx >= dst.width) continue
      const si = (sy * src.width + sx) * 4
      const di = (dy * dst.width + dx) * 4
      const sa = (src.data[si + 3] ?? 0) / 255
      if (sa === 0) continue
      const da = (dst.data[di + 3] ?? 0) / 255
      const oa = sa + da * (1 - sa)
      for (let c = 0; c < 3; c++) {
        const s = src.data[si + c] ?? 0
        const d = dst.data[di + c] ?? 0
        out.data[di + c] = oa === 0 ? 0 : (s * sa + d * da * (1 - sa)) / oa
      }
      out.data[di + 3] = oa * 255
    }
  }
  return out
}

/**
 * The painting on a stone wall. The wall is (blocksW + 2*margin, plus 2 with a reference) by
 * (blocksH + 2*margin) blocks; the painting sits at (margin, margin). The optional 1x1 reference
 * painting stands one block to the right, bottom-aligned with the painting.
 */
export function renderWallPreview(
  painting: Raster,
  blocksW: number,
  blocksH: number,
  ppb: number,
  opts: { margin?: number; reference?: boolean } = {},
): Raster {
  const margin = opts.margin ?? 1
  const reference = opts.reference ?? true
  const wall = renderStoneWall(
    blocksW + 2 * margin + (reference ? 2 : 0),
    blocksH + 2 * margin,
    ppb,
  )
  let out = compositeOver(wall, painting, margin * ppb, margin * ppb)
  if (reference) {
    const ref = applyWindow(renderScene('meadow', ppb, ppb), {
      shape: 'full',
      glassOpacity: 1,
      material: 'dark_oak',
      thickness: Math.max(1, Math.round(ppb / 16)),
      pixelsPerBlock: ppb,
      seed: 0,
    })
    out = compositeOver(out, ref, (margin + blocksW + 1) * ppb, (margin + blocksH - 1) * ppb)
  }
  return out
}
