import { cloneRaster, type Raster, type RGB } from './raster.ts'

/** Representative average colours of common Minecraft blocks. */
export const BLOCK_PALETTE: RGB[] = [
  // concrete
  [207, 213, 214],
  [224, 97, 1],
  [169, 48, 159],
  [36, 137, 199],
  [241, 175, 21],
  [94, 169, 24],
  [214, 101, 143],
  [55, 58, 62],
  [125, 125, 115],
  [21, 119, 136],
  [100, 32, 156],
  [45, 47, 143],
  [96, 60, 32],
  [73, 91, 36],
  [142, 33, 33],
  [8, 10, 15],
  // terracotta
  [152, 94, 68],
  [210, 178, 161],
  // planks
  [162, 131, 79],
  [115, 85, 49],
  [192, 175, 121],
  [67, 43, 20],
  // natural blocks
  [126, 126, 126],
  [80, 80, 82],
  [127, 178, 56],
  [134, 96, 67],
  [219, 207, 163],
  [63, 118, 228],
  [249, 254, 254],
  [98, 38, 38],
  [246, 208, 61],
  [30, 67, 140],
]

/**
 * Reduces the colours of every non-transparent pixel. `auto` builds a palette of `colors`
 * (2..64) by median cut; `blocks` uses BLOCK_PALETTE. Optional Floyd–Steinberg dithering.
 * Alpha is kept, and fully transparent pixels are left untouched.
 */
export function quantize(
  r: Raster,
  o: { colors: number; palette: 'auto' | 'blocks'; dither: boolean },
): Raster {
  const palette =
    o.palette === 'blocks'
      ? BLOCK_PALETTE
      : medianCut(r, Math.min(64, Math.max(2, Math.round(o.colors))))
  if (palette.length === 0) return cloneRaster(r)
  return o.dither ? mapDithered(r, palette) : mapNearest(r, palette)
}

function nearest(palette: readonly RGB[], r: number, g: number, b: number): RGB {
  let best = palette[0] ?? [0, 0, 0]
  let bestD = Infinity
  for (const c of palette) {
    const dr = c[0] - r
    const dg = c[1] - g
    const db = c[2] - b
    const d = dr * dr + dg * dg + db * db
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

function mapNearest(r: Raster, palette: readonly RGB[]): Raster {
  const out = cloneRaster(r)
  const d = out.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const c = nearest(palette, d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0)
    d[i] = c[0]
    d[i + 1] = c[1]
    d[i + 2] = c[2]
  }
  return out
}

/** Floyd–Steinberg; error only flows between non-transparent pixels. */
function mapDithered(r: Raster, palette: readonly RGB[]): Raster {
  const { width: w, height: h } = r
  const out = cloneRaster(r)
  const d = out.data
  const err = new Float32Array(w * h * 3)
  const spread = (x: number, y: number, er: number, eg: number, eb: number, k: number) => {
    if (x < 0 || x >= w || y >= h) return
    const p = y * w + x
    if (d[p * 4 + 3] === 0) return
    err[p * 3] = (err[p * 3] ?? 0) + er * k
    err[p * 3 + 1] = (err[p * 3 + 1] ?? 0) + eg * k
    err[p * 3 + 2] = (err[p * 3 + 2] ?? 0) + eb * k
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const i = p * 4
      if (d[i + 3] === 0) continue
      const vr = clamp((d[i] ?? 0) + (err[p * 3] ?? 0))
      const vg = clamp((d[i + 1] ?? 0) + (err[p * 3 + 1] ?? 0))
      const vb = clamp((d[i + 2] ?? 0) + (err[p * 3 + 2] ?? 0))
      const c = nearest(palette, vr, vg, vb)
      d[i] = c[0]
      d[i + 1] = c[1]
      d[i + 2] = c[2]
      const er = vr - c[0]
      const eg = vg - c[1]
      const eb = vb - c[2]
      spread(x + 1, y, er, eg, eb, 7 / 16)
      spread(x - 1, y + 1, er, eg, eb, 3 / 16)
      spread(x, y + 1, er, eg, eb, 5 / 16)
      spread(x + 1, y + 1, er, eg, eb, 1 / 16)
    }
  }
  return out
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

interface Bin {
  r: number
  g: number
  b: number
  count: number
}

/**
 * Median cut over a 15-bit colour histogram of the non-transparent pixels. Each bin keeps its
 * exact mean colour, so images with few colours keep them exactly.
 */
function medianCut(r: Raster, colors: number): RGB[] {
  const sums = new Float64Array(32768 * 4)
  const d = r.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const red = d[i] ?? 0
    const green = d[i + 1] ?? 0
    const blue = d[i + 2] ?? 0
    const k = (((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3)) * 4
    sums[k] = (sums[k] ?? 0) + red
    sums[k + 1] = (sums[k + 1] ?? 0) + green
    sums[k + 2] = (sums[k + 2] ?? 0) + blue
    sums[k + 3] = (sums[k + 3] ?? 0) + 1
  }
  const bins: Bin[] = []
  for (let k = 0; k < sums.length; k += 4) {
    const count = sums[k + 3] ?? 0
    if (count > 0) {
      bins.push({
        r: (sums[k] ?? 0) / count,
        g: (sums[k + 1] ?? 0) / count,
        b: (sums[k + 2] ?? 0) / count,
        count,
      })
    }
  }
  if (bins.length === 0) return []

  const boxes: Bin[][] = [bins]
  while (boxes.length < colors) {
    let pick = -1
    let pickRange = 0
    let pickChannel: 'r' | 'g' | 'b' = 'r'
    boxes.forEach((box, index) => {
      if (box.length < 2) return
      for (const ch of ['r', 'g', 'b'] as const) {
        let lo = Infinity
        let hi = -Infinity
        for (const bin of box) {
          lo = Math.min(lo, bin[ch])
          hi = Math.max(hi, bin[ch])
        }
        if (hi - lo > pickRange) {
          pickRange = hi - lo
          pick = index
          pickChannel = ch
        }
      }
    })
    const box = boxes[pick]
    if (!box) break
    const ch = pickChannel
    box.sort((a, b) => a[ch] - b[ch])
    const total = box.reduce((s, bin) => s + bin.count, 0)
    let acc = 0
    let cut = 1
    for (; cut < box.length - 1; cut++) {
      acc += box[cut - 1]?.count ?? 0
      if (acc >= total / 2) break
    }
    boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut))
  }

  return boxes.map((box) => {
    let sr = 0
    let sg = 0
    let sb = 0
    let n = 0
    for (const bin of box) {
      sr += bin.r * bin.count
      sg += bin.g * bin.count
      sb += bin.b * bin.count
      n += bin.count
    }
    return [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)] as const
  })
}
