import { createRaster, type Raster } from './raster.ts'
import { resample } from './resample.ts'
import { renderScene } from './scenes.ts'
import { applyWindow } from './window.ts'

const STONE_SEED = 42

/** A deterministic hash of two integers and a salt, as an unsigned 32-bit number. */
function hash2(x: number, y: number, salt: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ salt) | 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

const MORTAR = 74
const FACE = 124

/**
 * Procedural stone bricks, 16 texels per block (each texel is ppb/16 px, at least 1 px): two
 * rows of bricks per block, the lower row offset by half a brick. Each brick has its own gentle
 * tone, a lit top and left edge and a shaded bottom and right edge; texel noise stays low so the
 * wall reads as bricks, not static (N6). Deterministic: the same arguments always give the same
 * pixels, and wall size never changes a texel.
 */
export function renderStoneWall(blocksW: number, blocksH: number, pixelsPerBlock: number): Raster {
  const width = blocksW * pixelsPerBlock
  const height = blocksH * pixelsPerBlock
  const out = createRaster(width, height)
  const texel = Math.max(1, pixelsPerBlock / 16)
  for (let y = 0; y < height; y++) {
    const ty = Math.floor(y / texel)
    const upper = ty % 16 < 8
    const by = ty % 8
    const row = Math.floor(ty / 8)
    for (let x = 0; x < width; x++) {
      const tx = Math.floor(x / texel)
      // Texels across the brick: the lower row is offset by half a brick.
      const shifted = upper ? tx : tx + 8
      const bx = shifted % 16
      let v: number
      if (by === 7 || bx === 15) {
        v = MORTAR + (hash2(tx, ty, STONE_SEED) % 5) - 2
      } else {
        const brick = hash2(Math.floor(shifted / 16), row, STONE_SEED + 1)
        v = FACE + (brick % 15) - 7 + (hash2(tx, ty, STONE_SEED + 2) % 7) - 3
        if (by === 0) v += 10
        else if (by === 6) v -= 8
        if (bx === 0) v += 5
        else if (bx === 14) v -= 6
      }
      const i = (y * width + x) * 4
      out.data[i] = v
      out.data[i + 1] = v
      out.data[i + 2] = v + 3
      out.data[i + 3] = 255
    }
  }
  return out
}

/**
 * The largest pixels per block, halving from `ppb`, at which a wall of `wallW` × `wallH` blocks
 * fits in `maxSide` pixels: previews are drawn at the size they are shown (N6).
 */
export function previewPixelsPerBlock(
  ppb: number,
  wallW: number,
  wallH: number,
  maxSide: number,
): number {
  let out = ppb
  while (out > 1 && Math.max(wallW, wallH) * out > maxSide) out = Math.max(1, Math.floor(out / 2))
  return out
}

/** Walls by size; a preview redraws often while its wall stays the same. */
const walls = new Map<string, Raster>()
const WALLS_KEPT = 4

function stoneWall(blocksW: number, blocksH: number, ppb: number): Raster {
  const key = `${blocksW}x${blocksH}@${ppb}`
  const kept = walls.get(key)
  if (kept) return kept
  const wall = renderStoneWall(blocksW, blocksH, ppb)
  walls.set(key, wall)
  if (walls.size > WALLS_KEPT) {
    const [oldest] = walls.keys()
    if (oldest !== undefined) walls.delete(oldest)
  }
  return wall
}

/** The 1×1 reference painting by pixels per block. */
const references = new Map<number, Raster>()

function referencePainting(ppb: number): Raster {
  const kept = references.get(ppb)
  if (kept) return kept
  const ref = applyWindow(renderScene('meadow', ppb, ppb), {
    shape: 'full',
    glassOpacity: 1,
    material: 'dark_oak',
    thickness: Math.max(1, Math.round(ppb / 16)),
    pixelsPerBlock: ppb,
    seed: 0,
  })
  references.set(ppb, ref)
  return ref
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
  const wall = stoneWall(blocksW + 2 * margin + (reference ? 2 : 0), blocksH + 2 * margin, ppb)
  let out = compositeOver(wall, painting, margin * ppb, margin * ppb)
  if (reference) {
    const ref = referencePainting(ppb)
    out = compositeOver(out, ref, (margin + blocksW + 1) * ppb, (margin + blocksH - 1) * ppb)
  }
  return out
}

/**
 * renderWallPreview drawn no bigger than it is shown: the painting is scaled down (sharp, by
 * halves) until the wall fits `maxSide` pixels. A 16×16 painting at 64 px per block in a small
 * preview then costs a sixteenth of the full-size wall.
 */
export function renderWallPreviewToFit(
  painting: Raster,
  blocksW: number,
  blocksH: number,
  ppb: number,
  maxSide: number,
  opts: { margin?: number; reference?: boolean } = {},
): Raster {
  const margin = opts.margin ?? 1
  const wallW = blocksW + 2 * margin + ((opts.reference ?? true) ? 2 : 0)
  const wallH = blocksH + 2 * margin
  const fit = previewPixelsPerBlock(ppb, wallW, wallH, maxSide)
  const shown = fit === ppb ? painting : resample(painting, blocksW * fit, blocksH * fit, 'sharp')
  return renderWallPreview(shown, blocksW, blocksH, fit, opts)
}
