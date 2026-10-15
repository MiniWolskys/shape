import { unzlibSync, zlibSync } from 'fflate'
import { ShapeError } from '../domain/errors.ts'
import type { EditLayer } from '../imaging/edits.ts'
import { createRaster, type Raster } from '../imaging/raster.ts'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
/** Bytes per pixel for each supported 8-bit colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 255] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** RGBA, 8 bit (colour type 6), filter 0 on every row, zlib level 9. */
export function encodePng(r: Raster): Uint8Array {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, r.width)
  view.setUint32(4, r.height)
  header.set([8, 6, 0, 0, 0], 8)
  const stride = r.width * 4
  const raw = new Uint8Array((stride + 1) * r.height)
  for (let y = 0; y < r.height; y++) {
    raw.set(r.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  return concat([
    new Uint8Array(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ])
}

function notAnImage(why: string): ShapeError {
  return new ShapeError('not-an-image', `This file is not a readable PNG image (${why}).`)
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** Reverses the five PNG row filters in place; returns the bare pixel bytes. */
function unfilter(raw: Uint8Array, stride: number, height: number, bpp: number): Uint8Array {
  const out = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const row = y * stride
    const prev = row - stride
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i] ?? 0
      const a = i >= bpp ? (out[row + i - bpp] ?? 0) : 0
      const b = y > 0 ? (out[prev + i] ?? 0) : 0
      const c = y > 0 && i >= bpp ? (out[prev + i - bpp] ?? 0) : 0
      let predictor: number
      if (type === 0) predictor = 0
      else if (type === 1) predictor = a
      else if (type === 2) predictor = b
      else if (type === 3) predictor = (a + b) >> 1
      else if (type === 4) predictor = paeth(a, b, c)
      else throw notAnImage(`unknown row filter ${String(type)}`)
      out[row + i] = (x + predictor) & 255
    }
  }
  return out
}

/**
 * Reads 8-bit, non-interlaced PNGs of colour type 0 (grey), 2 (RGB), 4 (grey + alpha) or 6 (RGBA).
 * CRCs are not checked. Anything else throws ShapeError('not-an-image').
 */
export function decodePng(bytes: Uint8Array): Raster {
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) {
    throw notAnImage('missing PNG signature')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  let colourType = -1
  const idat: Uint8Array[] = []
  let at = 8
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const data = bytes.subarray(at + 8, at + 8 + length)
    if (data.length !== length) throw notAnImage('truncated chunk')
    if (type === 'IHDR') {
      if (length < 13) throw notAnImage('bad header')
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      const [bitDepth, ct, compression, filter, interlace] = data.subarray(8, 13)
      if (bitDepth !== 8) throw notAnImage(`${String(bitDepth)}-bit images are not supported`)
      if (ct === undefined || CHANNELS[ct] === undefined) {
        throw notAnImage(`colour type ${String(ct)} is not supported`)
      }
      if (compression !== 0 || filter !== 0) throw notAnImage('unknown compression')
      if (interlace !== 0) throw notAnImage('interlaced images are not supported')
      colourType = ct
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    at += 12 + length
  }
  const channels = CHANNELS[colourType]
  if (channels === undefined || width === 0 || height === 0) throw notAnImage('missing header')
  let raw: Uint8Array
  try {
    raw = unzlibSync(concat(idat))
  } catch (e) {
    throw notAnImage(`corrupt image data: ${e instanceof Error ? e.message : String(e)}`)
  }
  const stride = width * channels
  if (raw.length < (stride + 1) * height) throw notAnImage('image data is too short')
  const pixels = unfilter(raw, stride, height, channels)
  const out = createRaster(width, height)
  for (let p = 0; p < width * height; p++) {
    const s = p * channels
    const d = p * 4
    const v0 = pixels[s] ?? 0
    if (channels === 1 || channels === 2) {
      out.data[d] = v0
      out.data[d + 1] = v0
      out.data[d + 2] = v0
      out.data[d + 3] = channels === 2 ? (pixels[s + 1] ?? 0) : 255
    } else {
      out.data[d] = v0
      out.data[d + 1] = pixels[s + 1] ?? 0
      out.data[d + 2] = pixels[s + 2] ?? 0
      out.data[d + 3] = channels === 4 ? (pixels[s + 3] ?? 0) : 255
    }
  }
  return out
}

const WHITE = [255, 255, 255, 255] as const
const BLACK = [0, 0, 0, 255] as const

/** Edit layer as two PNGs: the values, and a mask with edited pixels white and others black. */
export function encodeEditLayer(layer: EditLayer): { values: Uint8Array; mask: Uint8Array } {
  const { width, height } = layer.values
  const mask = createRaster(width, height)
  for (let p = 0; p < width * height; p++) mask.data.set(layer.mask[p] === 1 ? WHITE : BLACK, p * 4)
  return { values: encodePng(layer.values), mask: encodePng(mask) }
}

export function decodeEditLayer(values: Uint8Array, mask: Uint8Array): EditLayer {
  const v = decodePng(values)
  const m = decodePng(mask)
  if (m.width !== v.width || m.height !== v.height) throw notAnImage('edit mask size mismatch')
  const bits = new Uint8Array(v.width * v.height)
  for (let p = 0; p < bits.length; p++) bits[p] = (m.data[p * 4] ?? 0) >= 128 ? 1 : 0
  return { values: v, mask: bits }
}
