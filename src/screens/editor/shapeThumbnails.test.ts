import { describe, expect, it } from 'vitest'
import { SHAPE_IDS } from '../../domain/types.ts'
import { shapeIcon, thumbnailSpec } from './shapeThumbnails.ts'

describe('thumbnailSpec', () => {
  it.each([
    [
      { width: 16, height: 16, pixelsPerBlock: 64 },
      { width: 4, height: 4 },
    ],
    [
      { width: 8, height: 4, pixelsPerBlock: 32 },
      { width: 4, height: 2 },
    ],
    [
      { width: 16, height: 3, pixelsPerBlock: 16 },
      { width: 4, height: 1 },
    ],
    [
      { width: 1, height: 2, pixelsPerBlock: 32 },
      { width: 2, height: 4 },
    ],
    [
      { width: 1, height: 1, pixelsPerBlock: 4 },
      { width: 4, height: 4 },
    ],
  ])(
    'draws %o with its aspect, 4 blocks on its longest side at 16 px per block (R30)',
    (p, size) => {
      expect(thumbnailSpec(p)).toEqual({ ...size, pixelsPerBlock: 16 })
    },
  )
})

describe('shapeIcon', () => {
  it('outlines every shape, each its own way', () => {
    const outlines = SHAPE_IDS.map((shape) => shapeIcon(shape).outline)
    for (const outline of outlines) expect(outline).toMatch(/^M/)
    expect(new Set(outlines).size).toBeGreaterThan(SHAPE_IDS.length / 2)
  })

  it('is worked out once per shape', () => {
    expect(shapeIcon('rose')).toBe(shapeIcon('rose'))
  })
})
