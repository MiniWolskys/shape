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

/** The plain search the fast one must agree with: first palette colour at the least distance. */
function bruteNearest(r: number, g: number, b: number): readonly [number, number, number] {
  let best = BLOCK_PALETTE[0] ?? [0, 0, 0]
  let bestD = Infinity
  for (const c of BLOCK_PALETTE) {
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

function noise(width: number, height: number): Raster {
  const r = createRaster(width, height)
  let s = 7
  const random = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let i = 0; i < r.data.length; i += 4) {
    r.data.set([random() * 256, random() * 256, random() * 256, random() < 0.1 ? 0 : 255], i)
  }
  return r
}

describe('fast nearest-colour search', () => {
  it('picks exactly what a full palette search picks', () => {
    const src = noise(160, 120)
    const out = quantize(src, { colors: 16, palette: 'blocks', dither: false })
    for (let i = 0; i < src.data.length; i += 4) {
      const expected =
        src.data[i + 3] === 0
          ? [src.data[i], src.data[i + 1], src.data[i + 2]]
          : bruteNearest(src.data[i] ?? 0, src.data[i + 1] ?? 0, src.data[i + 2] ?? 0)
      const got = [...out.data.subarray(i, i + 3)]
      if (got.some((v, c) => v !== expected[c])) {
        expect(got, `pixel ${i / 4}`).toEqual(expected)
      }
    }
  })

  it('dithers exactly like Floyd–Steinberg over a full palette search', () => {
    const src = noise(64, 48)
    const { width: w, height: h } = src
    const ref = new Uint8ClampedArray(src.data)
    const err = new Float32Array(w * h * 3)
    const clamp = (v: number) => Math.min(255, Math.max(0, v))
    for (let p = 0; p < w * h; p++) {
      if (ref[p * 4 + 3] === 0) continue
      const v = [0, 1, 2].map((c) => clamp((ref[p * 4 + c] ?? 0) + (err[p * 3 + c] ?? 0)))
      const [vr = 0, vg = 0, vb = 0] = v
      const c = bruteNearest(vr, vg, vb)
      ref.set(c, p * 4)
      const x = p % w
      const y = (p - x) / w
      for (const [dx, dy, k] of [
        [1, 0, 7 / 16],
        [-1, 1, 3 / 16],
        [0, 1, 5 / 16],
        [1, 1, 1 / 16],
      ] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= w || ny >= h || ref[(ny * w + nx) * 4 + 3] === 0) continue
        for (let ch = 0; ch < 3; ch++) {
          const e = (ny * w + nx) * 3 + ch
          err[e] = (err[e] ?? 0) + ((v[ch] ?? 0) - (c[ch] ?? 0)) * k
        }
      }
    }
    const out = quantize(src, { colors: 16, palette: 'blocks', dither: true })
    expect(out.data.every((value, i) => value === ref[i])).toBe(true)
  })
})
