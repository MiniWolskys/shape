import { describe, expect, it } from 'vitest'
import { createEditLayer } from './edits.ts'
import { createRaster, getPixel, setPixel } from './raster.ts'
import {
  brushFootprint,
  colorDistance,
  eyedropper,
  maskSize,
  paintMask,
  pencil,
  pencilInto,
  selectSimilar,
} from './tools.ts'

function wallImage() {
  // 3x3: columns 0 and 2 white, column 1 black
  const r = createRaster(3, 3, [255, 255, 255, 255])
  for (let y = 0; y < 3; y++) setPixel(r, 1, y, [0, 0, 0, 255])
  return r
}

describe('selectSimilar', () => {
  it('contiguous fill stays on its side of the wall', () => {
    const m = selectSimilar(wallImage(), 0, 0, 0, true)
    expect(Array.from(m)).toEqual([1, 0, 0, 1, 0, 0, 1, 0, 0])
  })
  it('non-contiguous selects both sides', () => {
    const m = selectSimilar(wallImage(), 0, 0, 0, false)
    expect(Array.from(m)).toEqual([1, 0, 1, 1, 0, 1, 1, 0, 1])
  })
  it('respects tolerance', () => {
    const r = createRaster(2, 1, [100, 100, 100, 255])
    setPixel(r, 1, 0, [105, 100, 100, 255])
    expect(maskSize(selectSimilar(r, 0, 0, 0, true))).toBe(1)
    expect(maskSize(selectSimilar(r, 0, 0, 10, true))).toBe(2)
  })
  it('returns an empty mask for an out-of-bounds start', () => {
    const m = selectSimilar(wallImage(), 5, 0, 10, true)
    expect(m.length).toBe(9)
    expect(maskSize(m)).toBe(0)
  })
  it('fills a 1024x1024 uniform image without overflowing the stack', () => {
    const r = createRaster(1024, 1024, [10, 20, 30, 255])
    expect(maskSize(selectSimilar(r, 500, 500, 0, true))).toBe(1_048_576)
  })
})

describe('colorDistance', () => {
  it('is the max channel difference including alpha', () => {
    expect(colorDistance([0, 0, 0, 255], [10, 3, 0, 255])).toBe(10)
    expect(colorDistance([0, 0, 0, 255], [0, 0, 0, 0])).toBe(255)
  })
})

describe('editing tools', () => {
  it('pencil draws a diagonal and ignores out-of-bounds points', () => {
    const layer = createEditLayer(4, 4)
    const out = pencil(
      layer,
      [
        [0, 0],
        [3, 3],
        [9, 9],
      ],
      [1, 2, 3, 255],
    )
    expect(maskSize(out.mask)).toBe(4)
    expect(getPixel(out.values, 2, 2)).toEqual([1, 2, 3, 255])
    expect(maskSize(layer.mask)).toBe(0)
  })
  it('pencil with a single point paints that pixel', () => {
    const out = pencil(createEditLayer(3, 3), [[1, 1]], [9, 9, 9, 255])
    expect(maskSize(out.mask)).toBe(1)
  })
  it('paintMask returns a new layer', () => {
    const layer = createEditLayer(2, 1)
    const out = paintMask(layer, Uint8Array.from([0, 1]), [5, 6, 7, 255])
    expect(out).not.toBe(layer)
    expect(Array.from(out.mask)).toEqual([0, 1])
    expect(getPixel(out.values, 1, 0)).toEqual([5, 6, 7, 255])
    expect(maskSize(layer.mask)).toBe(0)
  })
  it('pencil ignores non-finite points and stays fast on huge coordinates', () => {
    const layer = createEditLayer(4, 4)
    const nan = pencil(
      layer,
      [
        [NaN, 1],
        [1, Infinity],
        [-Infinity, 0],
      ],
      [1, 1, 1, 255],
    )
    expect(maskSize(nan.mask)).toBe(0)
    const start = Date.now()
    const far = pencil(
      layer,
      [
        [0, 0],
        [1e9, 1e9],
      ],
      [1, 1, 1, 255],
    )
    expect(Date.now() - start).toBeLessThan(500)
    expect(maskSize(far.mask)).toBe(4)
    const across = pencil(
      layer,
      [
        [-1e9, 1],
        [1e9, 1],
      ],
      [1, 1, 1, 255],
    )
    expect(maskSize(across.mask)).toBe(4)
  })
  it('eyedropper clamps out-of-bounds coordinates', () => {
    const r = wallImage()
    expect(eyedropper(r, -1, 1)).toEqual(getPixel(r, 0, 1))
    expect(eyedropper(r, 9, 9)).toEqual(getPixel(r, 2, 2))
    expect(eyedropper(r, 1.7, 0.2)).toEqual(getPixel(r, 1, 0))
  })
  it('eyedropper reads a pixel', () => {
    expect(eyedropper(wallImage(), 1, 1)).toEqual([0, 0, 0, 255])
  })
})

describe('square brush', () => {
  const painted = (layer: ReturnType<typeof createEditLayer>) => {
    const out: string[] = []
    const w = layer.values.width
    layer.mask.forEach((m, p) => {
      if (m === 1) out.push(`${p % w},${Math.floor(p / w)}`)
    })
    return out
  }

  it.each([
    [1, { x0: 5, y0: 5, x1: 5, y1: 5 }],
    [2, { x0: 4, y0: 4, x1: 5, y1: 5 }],
    [4, { x0: 3, y0: 3, x1: 6, y1: 6 }],
    [8, { x0: 1, y0: 1, x1: 8, y1: 8 }],
  ])('a %i px brush covers a square around the pixel', (size, box) => {
    expect(brushFootprint(5, 5, size)).toEqual(box)
  })

  it('size 1 paints exactly what the 1 px pencil paints', () => {
    const a = pencil(
      createEditLayer(8, 8),
      [
        [0, 0],
        [7, 3],
      ],
      [1, 2, 3, 255],
    )
    const b = pencilInto(
      createEditLayer(8, 8),
      [
        [0, 0],
        [7, 3],
      ],
      [1, 2, 3, 255],
      1,
    )
    expect(Array.from(b.mask)).toEqual(Array.from(a.mask))
  })

  it('stamps a 4 px square at a single point', () => {
    const layer = pencilInto(createEditLayer(8, 8), [[4, 4]], [9, 9, 9, 255], 4)
    expect(maskSize(layer.mask)).toBe(16)
    expect(painted(layer)).toContain('2,2')
    expect(painted(layer)).toContain('5,5')
    expect(painted(layer)).not.toContain('6,6')
    expect(Array.from(layer.values.data.slice((2 * 8 + 2) * 4, (2 * 8 + 2) * 4 + 4))).toEqual([
      9, 9, 9, 255,
    ])
  })

  it('drags the square along a line, leaving a band as wide as the brush', () => {
    const layer = pencilInto(
      createEditLayer(16, 16),
      [
        [2, 8],
        [13, 8],
      ],
      [9, 9, 9, 255],
      2,
    )
    // Rows 7 and 8, columns 1..13.
    expect(maskSize(layer.mask)).toBe(2 * 13)
  })

  it('paints the part of the brush still on the painting when its centre is just off it', () => {
    // An 8 px brush centred one pixel left of the painting still reaches columns 0..2.
    const layer = pencilInto(createEditLayer(8, 8), [[-1, 4]], [9, 9, 9, 255], 8)
    expect(maskSize(layer.mask)).toBe(3 * 8)
    // A line running just outside the left edge paints along it.
    const line = pencilInto(
      createEditLayer(8, 8),
      [
        [-2, 0],
        [-2, 7],
      ],
      [9, 9, 9, 255],
      8,
    )
    expect(painted(line)).toContain('0,7')
    expect(painted(line)).toContain('1,0')
    expect(painted(line)).not.toContain('2,0')
  })

  it('stays fast and bounded on huge coordinates with a big brush', () => {
    const layer = createEditLayer(64, 64)
    const start = performance.now()
    pencilInto(
      layer,
      [
        [-1e9, -1e9],
        [1e9, 1e9],
      ],
      [9, 9, 9, 255],
      8,
    )
    expect(performance.now() - start).toBeLessThan(200)
    expect(maskSize(layer.mask)).toBeGreaterThan(0)
  })
})
