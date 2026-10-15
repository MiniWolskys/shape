import { describe, expect, it } from 'vitest'
import { createRaster, getPixel } from './raster.ts'
import { renderScene } from './scenes.ts'
import { applyWindow } from './window.ts'
import {
  compositeOver,
  previewPixelsPerBlock,
  renderStoneWall,
  renderWallPreview,
  renderWallPreviewToFit,
} from './wall.ts'

describe('renderStoneWall', () => {
  it('is sized by blocks and fully opaque', () => {
    const w = renderStoneWall(2, 1, 16)
    expect([w.width, w.height]).toEqual([32, 16])
    for (let i = 3; i < w.data.length; i += 4) expect(w.data[i]).toBe(255)
  })
  it('is deterministic', () => {
    expect(renderStoneWall(2, 2, 16).data).toEqual(renderStoneWall(2, 2, 16).data)
  })
  it('reads as bricks: clear mortar, calm faces, a tone per brick (N6)', () => {
    const w = renderStoneWall(4, 4, 16)
    const grey = (x: number, y: number) => getPixel(w, x, y)[0] ?? 0
    const mortar: number[] = []
    const faces = new Map<string, number[]>()
    const interiors = new Map<string, number[]>()
    for (let y = 0; y < w.height; y++) {
      for (let x = 0; x < w.width; x++) {
        const ly = y % 16
        const upper = ly < 8
        const bx = (upper ? x : x + 8) % 16
        const by = ly % 8
        if (by === 7 || bx === 15) {
          mortar.push(grey(x, y))
          continue
        }
        const key = `${Math.floor(y / 8)}:${Math.floor((upper ? x : x + 8) / 16)}`
        faces.set(key, [...(faces.get(key) ?? []), grey(x, y)])
        // Away from the bevelled edges of the brick.
        if (by >= 1 && by <= 5 && bx >= 1 && bx <= 13) {
          interiors.set(key, [...(interiors.get(key) ?? []), grey(x, y)])
        }
      }
    }
    const brightestMortar = Math.max(...mortar)
    const faceValues = [...faces.values()]
    for (const face of faceValues) expect(Math.min(...face)).toBeGreaterThan(brightestMortar + 8)
    for (const inside of interiors.values()) {
      expect(Math.max(...inside) - Math.min(...inside)).toBeLessThanOrEqual(8)
    }
    const tones = new Set(
      faceValues.map((face) => Math.round(face.reduce((a, b) => a + b) / face.length)),
    )
    expect(tones.size).toBeGreaterThan(3)
  })

  it('handles small pixel densities', () => {
    const w = renderStoneWall(1, 1, 4)
    expect([w.width, w.height]).toEqual([4, 4])
  })
})

describe('compositeOver', () => {
  it('blends half-transparent white over black to about 128', () => {
    const dst = createRaster(1, 1, [0, 0, 0, 255])
    const src = createRaster(1, 1, [255, 255, 255, 128])
    const out = compositeOver(dst, src, 0, 0)
    expect(getPixel(out, 0, 0)[0]).toBeGreaterThanOrEqual(127)
    expect(getPixel(out, 0, 0)[0]).toBeLessThanOrEqual(129)
    expect(getPixel(dst, 0, 0)[0]).toBe(0)
  })
  it('clips sources that overhang', () => {
    const out = compositeOver(
      createRaster(2, 2, [0, 0, 0, 255]),
      createRaster(2, 2, [9, 9, 9, 255]),
      1,
      1,
    )
    expect(getPixel(out, 1, 1)[0]).toBe(9)
    expect(getPixel(out, 0, 0)[0]).toBe(0)
  })
})

describe('renderWallPreview', () => {
  it('adds margin and a reference slot', () => {
    const painting = createRaster(32, 16, [255, 0, 0, 255])
    const w = renderWallPreview(painting, 2, 1, 16)
    expect([w.width, w.height]).toEqual([96, 48])
    expect(getPixel(w, 16, 16)).toEqual([255, 0, 0, 255])
  })
  it('can omit the reference', () => {
    const painting = createRaster(16, 16, [255, 0, 0, 255])
    const w = renderWallPreview(painting, 1, 1, 16, { reference: false })
    expect([w.width, w.height]).toEqual([48, 48])
  })
  it('places the framed reference painting bottom-aligned, one block right', () => {
    const painting = createRaster(16, 32, [255, 0, 0, 255])
    const withRef = renderWallPreview(painting, 1, 2, 16)
    const noRef = compositeOver(renderStoneWall(5, 4, 16), painting, 16, 16)
    // reference block: x = 3 blocks, y = 2 blocks (bottom row of the painting)
    const rx = 3 * 16
    const ry = 2 * 16
    const expected = applyWindow(renderScene('meadow', 16, 16), {
      shape: 'full',
      glassOpacity: 1,
      material: 'dark_oak',
      thickness: 1,
      pixelsPerBlock: 16,
      seed: 0,
    })
    expect(getPixel(withRef, rx + 8, ry + 8)).toEqual(getPixel(expected, 8, 8))
    expect(getPixel(withRef, rx + 8, ry + 8)).not.toEqual(getPixel(noRef, rx + 8, ry + 8))
    // block row above the reference is plain wall
    for (const [x, y] of [
      [rx + 8, ry - 8],
      [rx + 2, ry - 1],
    ] as const) {
      expect(getPixel(withRef, x, y)).toEqual(getPixel(noRef, x, y))
    }
    // frame border is dark oak, opaque
    const border = getPixel(withRef, rx, ry + 8)
    expect(border[3]).toBe(255)
    ;[74, 47, 28].forEach((v, c) => expect(Math.abs((border[c] ?? 0) - v)).toBeLessThanOrEqual(16))
  })
})

describe('previewPixelsPerBlock', () => {
  it('keeps the resolution when the wall fits the preview', () => {
    expect(previewPixelsPerBlock(32, 5, 3, 600)).toBe(32)
  })
  it('halves the resolution until the wall fits (N6)', () => {
    // A 16×16 painting at 64 px per block: the wall is 20 blocks wide.
    expect(previewPixelsPerBlock(64, 20, 18, 580)).toBe(16)
    expect(previewPixelsPerBlock(64, 20, 18, 1280)).toBe(64)
    expect(previewPixelsPerBlock(3, 100, 100, 10)).toBe(1)
  })
})

describe('renderWallPreviewToFit', () => {
  it('draws the wall at the size it is shown, the painting scaled down with it', () => {
    const painting = createRaster(64, 64, [255, 0, 0, 255])
    const w = renderWallPreviewToFit(painting, 1, 1, 64, 100)
    // 5 × 3 blocks at 16 px per block.
    expect([w.width, w.height]).toEqual([80, 48])
    expect(getPixel(w, 24, 24)).toEqual([255, 0, 0, 255])
  })
})
