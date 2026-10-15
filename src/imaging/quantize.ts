import { cloneRaster, type Raster, type RGB } from './raster.ts'

/**
 * Representative average colours of common Minecraft blocks. Skies need the pale blues, cyans
 * and light greys (M17). The order only matters for exact ties, which go to the first entry.
 */
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
  // wool: white, light blue, cyan, light grey
  [233, 236, 236],
  [58, 175, 217],
  [21, 137, 145],
  [142, 142, 134],
  // concrete powder: light blue, cyan, white
  [74, 180, 213],
  [36, 147, 157],
  [225, 227, 227],
  // terracotta: plain, white, light blue, cyan, light grey
  [152, 94, 68],
  [210, 178, 161],
  [113, 108, 137],
  [86, 91, 91],
  [135, 107, 98],
  // ice, packed ice, blue ice, diamond block, prismarine
  [145, 183, 253],
  [141, 180, 250],
  [116, 167, 253],
  [98, 237, 228],
  [99, 156, 151],
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
 * (2..64) by median cut; `blocks` uses BLOCK_PALETTE, matched by how alike colours look (OKLab).
 * Optional Floyd–Steinberg dithering. Alpha is kept, and fully transparent pixels are left
 * untouched.
 */
export function quantize(
  r: Raster,
  o: { colors: number; palette: 'auto' | 'blocks'; dither: boolean },
): Raster {
  if (o.palette === 'blocks') {
    return mapToPalette(r, BLOCK_PALETTE, { dither: o.dither, metric: 'oklab' })
  }
  const palette = medianCut(r, Math.min(64, Math.max(2, Math.round(o.colors))))
  return mapToPalette(r, palette, { dither: o.dither, metric: 'rgb' })
}

/**
 * Maps every non-transparent pixel to its nearest palette colour: by RGB distance, or by
 * perceptual distance (OKLab, for the hand-picked block colours, whose RGB distances say a pale
 * sky is closer to grey than to light blue). Ties go to the first palette entry.
 */
export function mapToPalette(
  r: Raster,
  palette: readonly RGB[],
  o: { dither: boolean; metric: 'rgb' | 'oklab' },
): Raster {
  if (palette.length === 0) return cloneRaster(r)
  const flat = flatten(palette)
  const nearest = o.metric === 'oklab' ? oklabFinder(palette) : nearestFinder(flat)
  return o.dither ? mapDithered(r, flat, nearest) : mapNearest(r, flat, nearest)
}

/** sRGB channel (0..255) to linear light, for every integer value. */
const LINEAR = Float64Array.from({ length: 256 }, (_, v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

/** OKLab coordinates (L, a, b) of an sRGB colour with integer channels 0..255. */
export function oklab(r: number, g: number, b: number): [number, number, number] {
  const lr = LINEAR[r] ?? 0
  const lg = LINEAR[g] ?? 0
  const lb = LINEAR[b] ?? 0
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/**
 * Answers of the perceptual search by palette, for every 24-bit colour asked so far (entry + 1,
 * 0 = not asked yet). The answer for a colour never changes, so the table is kept between
 * renders: 16 MB, made the first time a palette is matched this way.
 */
const oklabAnswers = new WeakMap<readonly RGB[], Uint8Array>()

/**
 * Finds the palette colour nearest in OKLab (channels are rounded first, so dithered values
 * match like the colours they round to). Returns the entry's offset in `flat`.
 */
function oklabFinder(palette: readonly RGB[]): (r: number, g: number, b: number) => number {
  const n = palette.length
  if (n > 255) throw new RangeError('A perceptual palette holds at most 255 colours')
  const lab = new Float64Array(n * 3)
  palette.forEach((c, k) => lab.set(oklab(c[0], c[1], c[2]), k * 3))
  let answers = oklabAnswers.get(palette)
  if (!answers) {
    answers = new Uint8Array(1 << 24)
    oklabAnswers.set(palette, answers)
  }
  const known = answers
  return (r, g, b) => {
    const ri = Math.round(r)
    const gi = Math.round(g)
    const bi = Math.round(b)
    const key = (ri << 16) | (gi << 8) | bi
    const cached = known[key] ?? 0
    if (cached !== 0) return (cached - 1) * 3
    const [l, a, bb] = oklab(ri, gi, bi)
    let best = 0
    let bestD = Infinity
    for (let k = 0; k < n; k++) {
      const dl = (lab[k * 3] ?? 0) - l
      const da = (lab[k * 3 + 1] ?? 0) - a
      const db = (lab[k * 3 + 2] ?? 0) - bb
      const d = dl * dl + da * da + db * db
      if (d < bestD) {
        bestD = d
        best = k
      }
    }
    known[key] = best + 1
    return best * 3
  }
}

/** The palette as flat r, g, b triplets, which the per-pixel searches read much faster. */
function flatten(palette: readonly RGB[]): Int32Array {
  const flat = new Int32Array(palette.length * 3)
  palette.forEach((c, k) => flat.set(c, k * 3))
  return flat
}

/** Colour cells are 8×8×8 cubes of the RGB space (5 bits per channel). */
const CELL = 8

/**
 * Finds nearest palette colours fast and exactly. For each colour cell it keeps only the palette
 * entries that can be nearest somewhere in the cell: those whose closest point of the cell is no
 * farther than the best guaranteed distance (the smallest "farthest point" distance). Every
 * entry that ties for nearest is kept too, so the first one in palette order still wins.
 */
function nearestFinder(flat: Int32Array): (r: number, g: number, b: number) => number {
  const n = flat.length / 3
  // Per channel and cell position (0..31): each entry's squared distance to the nearest and to
  // the farthest point of that slab. A cell's distances are sums over its three slabs.
  const near = new Float64Array(3 * 32 * n)
  const far = new Float64Array(3 * 32 * n)
  for (let c = 0; c < 3; c++) {
    for (let pos = 0; pos < 32; pos++) {
      // The cell spans [a, a + CELL] (closed, so float values up to 255 are covered).
      const a = pos * CELL
      for (let e = 0; e < n; e++) {
        const v = flat[e * 3 + c] ?? 0
        const out = v < a ? a - v : v > a + CELL ? v - a - CELL : 0
        const span = Math.max(v - a, a + CELL - v)
        near[(c * 32 + pos) * n + e] = out * out
        far[(c * 32 + pos) * n + e] = span * span
      }
    }
  }
  // Candidates of each cell, worked out on first use: pool[start[cell] ..+ count[cell]].
  const start = new Int32Array(32 * 32 * 32).fill(-1)
  const count = new Uint8Array(32 * 32 * 32)
  let pool = new Int32Array(4096)
  let used = 0
  const fill = (cell: number) => {
    const ro = (cell >> 10) * n
    const go = (32 + ((cell >> 5) & 31)) * n
    const bo = (64 + (cell & 31)) * n
    let bound = Infinity
    for (let e = 0; e < n; e++) {
      const f = (far[ro + e] ?? 0) + (far[go + e] ?? 0) + (far[bo + e] ?? 0)
      if (f < bound) bound = f
    }
    if (used + n > pool.length) {
      const grown = new Int32Array(pool.length * 2 + n)
      grown.set(pool)
      pool = grown
    }
    start[cell] = used
    for (let e = 0; e < n; e++) {
      if ((near[ro + e] ?? 0) + (near[go + e] ?? 0) + (near[bo + e] ?? 0) <= bound) {
        pool[used++] = e * 3
      }
    }
    count[cell] = used - (start[cell] ?? 0)
  }
  return (r, g, b) => {
    // Channels are 0..255 (floats when dithering), so a shift is the floor, at most 31.
    const cell = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    if (start[cell] === -1) fill(cell)
    const from = start[cell] ?? 0
    const to = from + (count[cell] ?? 0)
    let best = pool[from] ?? 0
    let bestD = Infinity
    for (let j = from; j < to; j++) {
      const k = pool[j] ?? 0
      const dr = (flat[k] ?? 0) - r
      const dg = (flat[k + 1] ?? 0) - g
      const db = (flat[k + 2] ?? 0) - b
      const d = dr * dr + dg * dg + db * db
      if (d < bestD) {
        bestD = d
        best = k
      }
    }
    return best
  }
}

type Finder = (r: number, g: number, b: number) => number

function mapNearest(r: Raster, flat: Int32Array, nearest: Finder): Raster {
  const out = cloneRaster(r)
  const d = out.data
  // Neighbouring pixels often share a colour: the last answer is reused for them.
  let last = -1
  let k = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const red = d[i] ?? 0
    const green = d[i + 1] ?? 0
    const blue = d[i + 2] ?? 0
    const color = (red << 16) | (green << 8) | blue
    if (color !== last) {
      k = nearest(red, green, blue)
      last = color
    }
    d[i] = flat[k] ?? 0
    d[i + 1] = flat[k + 1] ?? 0
    d[i + 2] = flat[k + 2] ?? 0
  }
  return out
}

/** Floyd–Steinberg; error only flows between non-transparent pixels. */
function mapDithered(r: Raster, flat: Int32Array, nearest: Finder): Raster {
  const { width: w, height: h } = r
  const out = cloneRaster(r)
  const d = out.data
  const err = new Float32Array(w * h * 3)
  /** Pushes a share `k` of the error onto pixel (x, y), unless it is outside or see-through. */
  const spread = (x: number, y: number, er: number, eg: number, eb: number, k: number) => {
    if (x < 0 || x >= w || y >= h) return
    const p = y * w + x
    if (d[p * 4 + 3] === 0) return
    const e = p * 3
    err[e] = (err[e] ?? 0) + er * k
    err[e + 1] = (err[e + 1] ?? 0) + eg * k
    err[e + 2] = (err[e + 2] ?? 0) + eb * k
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const i = p * 4
      if (d[i + 3] === 0) continue
      const vr = clamp((d[i] ?? 0) + (err[p * 3] ?? 0))
      const vg = clamp((d[i + 1] ?? 0) + (err[p * 3 + 1] ?? 0))
      const vb = clamp((d[i + 2] ?? 0) + (err[p * 3 + 2] ?? 0))
      const k = nearest(vr, vg, vb)
      const cr = flat[k] ?? 0
      const cg = flat[k + 1] ?? 0
      const cb = flat[k + 2] ?? 0
      d[i] = cr
      d[i + 1] = cg
      d[i + 2] = cb
      const er = vr - cr
      const eg = vg - cg
      const eb = vb - cb
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

/** Histogram bins as parallel arrays: mean colour per channel, and pixel count. */
interface Bins {
  channels: [Float64Array, Float64Array, Float64Array]
  count: Float64Array
}

/** Highest minus lowest bin colour, per channel, over the bins (indices) of a box. */
function rangesOf(bins: Bins, box: readonly number[]): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const values = bins.channels[c] ?? bins.count
    let lo = Infinity
    let hi = -Infinity
    for (const b of box) {
      const v = values[b] ?? 0
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    out[c] = hi - lo
  }
  return out
}

/**
 * Median cut over a 15-bit colour histogram of the non-transparent pixels. Each bin keeps its
 * exact mean colour, so images with few colours keep them exactly. Boxes hold bin indices, and
 * each box's ranges are measured once, when it is made.
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
  let size = 0
  for (let k = 3; k < sums.length; k += 4) if ((sums[k] ?? 0) > 0) size++
  if (size === 0) return []
  const bins: Bins = {
    channels: [new Float64Array(size), new Float64Array(size), new Float64Array(size)],
    count: new Float64Array(size),
  }
  const [binR, binG, binB] = bins.channels
  const all: number[] = []
  for (let k = 0, b = 0; k < sums.length; k += 4) {
    const count = sums[k + 3] ?? 0
    if (count === 0) continue
    binR[b] = (sums[k] ?? 0) / count
    binG[b] = (sums[k + 1] ?? 0) / count
    binB[b] = (sums[k + 2] ?? 0) / count
    bins.count[b] = count
    all.push(b++)
  }

  const boxes: number[][] = [all]
  const ranges: Array<[number, number, number]> = [rangesOf(bins, all)]
  while (boxes.length < colors) {
    let pick = -1
    let pickRange = 0
    let pickChannel = 0
    boxes.forEach((box, index) => {
      if (box.length < 2) return
      const range = ranges[index] ?? [0, 0, 0]
      for (let c = 0; c < 3; c++) {
        const span = range[c] ?? 0
        if (span > pickRange) {
          pickRange = span
          pick = index
          pickChannel = c
        }
      }
    })
    const box = boxes[pick]
    if (!box) break
    const values = bins.channels[pickChannel] ?? binR
    // Array sort is stable: equal values keep their order.
    box.sort((a, b) => (values[a] ?? 0) - (values[b] ?? 0))
    const total = box.reduce((s, b) => s + (bins.count[b] ?? 0), 0)
    let acc = 0
    let cut = 1
    for (; cut < box.length - 1; cut++) {
      acc += bins.count[box[cut - 1] ?? 0] ?? 0
      if (acc >= total / 2) break
    }
    const low = box.slice(0, cut)
    const high = box.slice(cut)
    boxes.splice(pick, 1, low, high)
    ranges.splice(pick, 1, rangesOf(bins, low), rangesOf(bins, high))
  }

  return boxes.map((box) => {
    let sr = 0
    let sg = 0
    let sb = 0
    let n = 0
    for (const b of box) {
      const count = bins.count[b] ?? 0
      sr += (binR[b] ?? 0) * count
      sg += (binG[b] ?? 0) * count
      sb += (binB[b] ?? 0) * count
      n += count
    }
    return [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)] as const
  })
}
