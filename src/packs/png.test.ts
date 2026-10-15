import { unzlibSync, zlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { ShapeError } from '../domain/errors.ts'
import { createEditLayer } from '../imaging/edits.ts'
import { createRaster, getPixel, type Raster } from '../imaging/raster.ts'
import { decodeEditLayer, decodePng, encodeEditLayer, encodePng } from './png.ts'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
}

/** A chunk with a zero CRC: the decoder does not check CRCs. */
function chunk(type: string, data: ArrayLike<number>): number[] {
  return [
    ...u32(data.length),
    ...[...type].map((c) => c.charCodeAt(0)),
    ...Array.from(data),
    0,
    0,
    0,
    0,
  ]
}

function hdr(width: number, height: number, colourType: number, bitDepth = 8, interlace = 0) {
  return chunk('IHDR', [...u32(width), ...u32(height), bitDepth, colourType, 0, 0, interlace])
}

function buildPng(ihdr: number[], raw: number[]): Uint8Array {
  return new Uint8Array([
    ...SIGNATURE,
    ...ihdr,
    ...chunk('IDAT', zlibSync(new Uint8Array(raw))),
    ...chunk('IEND', []),
  ])
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** Forward PNG filter of one scanline (the encoder only ever writes filter 0). */
function filterRow(type: number, row: number[], prev: number[], bpp: number): number[] {
  return row.map((x, i) => {
    const a = i >= bpp ? (row[i - bpp] ?? 0) : 0
    const b = prev[i] ?? 0
    const c = i >= bpp ? (prev[i - bpp] ?? 0) : 0
    const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][type] ?? 0
    return (x - predictor) & 255
  })
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    return e instanceof ShapeError ? e.code : 'other'
  }
  return undefined
}

describe('png', () => {
  it('round-trips a random raster', () => {
    const r = createRaster(7, 5)
    let seed = 12345
    for (let i = 0; i < r.data.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      r.data[i] = seed & 255
    }
    const back = decodePng(encodePng(r))
    expect(back.width).toBe(7)
    expect(back.height).toBe(5)
    expect(Array.from(back.data)).toEqual(Array.from(r.data))
  })

  it('filters each row with the filter whose bytes sum smallest (R39), deterministically', () => {
    // Every row repeats the first: Up leaves nothing but zeros below it.
    const r = createRaster(16, 4)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 16; x++)
        r.data.set([(x * 37) & 255, (x * 91) & 255, x * 3, 255], (y * 16 + x) * 4)
    }
    const bytes = encodePng(r)
    expect(encodePng(r)).toEqual(bytes)
    // IDAT starts after the signature (8) and IHDR (25), past its length and type (8).
    const length = new DataView(bytes.buffer).getUint32(33)
    const raw = unzlibSync(bytes.subarray(41, 41 + length))
    const types = [0, 1, 2, 3].map((y) => raw[y * (16 * 4 + 1)])
    expect(types.slice(1)).toEqual([2, 2, 2])
    expect(Array.from(decodePng(bytes).data)).toEqual(Array.from(r.data))
  })

  it('writes a colour type 6, 8 bit PNG', () => {
    const bytes = encodePng(createRaster(3, 2, [1, 2, 3, 4]))
    expect(Array.from(bytes.subarray(0, 8))).toEqual(SIGNATURE)
    expect(bytes[24]).toBe(8)
    expect(bytes[25]).toBe(6)
  })

  it('rejects bytes that are not a PNG', () => {
    expect(codeOf(() => decodePng(new Uint8Array([0, 1, 2])))).toBe('not-an-image')
  })

  it('decodes an RGB image with a Sub (type 1) row', () => {
    const rows = [
      [10, 20, 30, 40, 50, 60],
      [200, 100, 50, 250, 90, 10],
    ]
    const raw = [0, ...(rows[0] ?? []), 1, ...filterRow(1, rows[1] ?? [], rows[0] ?? [], 3)]
    const r = decodePng(buildPng(hdr(2, 2, 2), raw))
    expect(getPixel(r, 0, 0)).toEqual([10, 20, 30, 255])
    expect(getPixel(r, 1, 0)).toEqual([40, 50, 60, 255])
    expect(getPixel(r, 0, 1)).toEqual([200, 100, 50, 255])
    expect(getPixel(r, 1, 1)).toEqual([250, 90, 10, 255])
  })

  it('undoes all five filters', () => {
    const width = 3
    const rows: number[][] = []
    for (let y = 0; y < 5; y++) {
      rows.push(
        Array.from({ length: width * 4 }, (_, i) => (y * 53 + i * 37 + ((i * y) % 7) * 29) & 255),
      )
    }
    const raw: number[] = []
    rows.forEach((row, y) => raw.push(y, ...filterRow(y, row, rows[y - 1] ?? [], 4)))
    const r = decodePng(buildPng(hdr(width, 5, 6), raw))
    expect(Array.from(r.data)).toEqual(rows.flat())
  })

  it('decodes grey and grey-alpha images', () => {
    const grey = decodePng(buildPng(hdr(2, 1, 0), [0, 7, 200]))
    expect(getPixel(grey, 0, 0)).toEqual([7, 7, 7, 255])
    expect(getPixel(grey, 1, 0)).toEqual([200, 200, 200, 255])
    const greyAlpha = decodePng(buildPng(hdr(1, 1, 4), [0, 9, 128]))
    expect(getPixel(greyAlpha, 0, 0)).toEqual([9, 9, 9, 128])
  })

  it('refuses 16 bit, palette and interlaced images', () => {
    expect(codeOf(() => decodePng(buildPng(hdr(1, 1, 6, 16), [0, 0, 0, 0, 0, 0, 0, 0, 0])))).toBe(
      'not-an-image',
    )
    expect(codeOf(() => decodePng(buildPng(hdr(1, 1, 3), [0, 0])))).toBe('not-an-image')
    expect(codeOf(() => decodePng(buildPng(hdr(1, 1, 6, 8, 1), [0, 0, 0, 0, 0])))).toBe(
      'not-an-image',
    )
  })

  it('refuses truncated image data', () => {
    expect(codeOf(() => decodePng(buildPng(hdr(2, 2, 6), [0, 1, 2, 3])))).toBe('not-an-image')
  })
})

describe('edit layer PNGs', () => {
  it('stores values and a black and white mask, and reads them back', () => {
    const layer = createEditLayer(2, 2)
    layer.mask[1] = 1
    layer.values.data.set([9, 8, 7, 6], 4)
    const stored = encodeEditLayer(layer)
    const mask: Raster = decodePng(stored.mask)
    expect(getPixel(mask, 0, 0)).toEqual([0, 0, 0, 255])
    expect(getPixel(mask, 1, 0)).toEqual([255, 255, 255, 255])
    const back = decodeEditLayer(stored.values, stored.mask)
    expect(Array.from(back.mask)).toEqual([0, 1, 0, 0])
    expect(Array.from(back.values.data)).toEqual(Array.from(layer.values.data))
  })
})
