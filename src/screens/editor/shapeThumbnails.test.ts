import { describe, expect, it } from 'vitest'
import { SHAPE_IDS } from '../../domain/types.ts'
import { shapeIcon, thumbnailSpec } from './shapeThumbnails.ts'

describe('thumbnailSpec', () => {
  it('draws big paintings as at most 2×2 blocks at 16 px per block, so leads stay readable', () => {
    expect(thumbnailSpec({ width: 16, height: 16, pixelsPerBlock: 64 })).toEqual({
      width: 2,
      height: 2,
      pixelsPerBlock: 16,
    })
    expect(thumbnailSpec({ width: 8, height: 4, pixelsPerBlock: 32 })).toEqual({
      width: 2,
      height: 1,
      pixelsPerBlock: 16,
    })
    expect(thumbnailSpec({ width: 16, height: 3, pixelsPerBlock: 16 })).toEqual({
      width: 2,
      height: 1,
      pixelsPerBlock: 16,
    })
  })

  it('keeps small paintings whole, never with more pixels per block than they have', () => {
    expect(thumbnailSpec({ width: 1, height: 2, pixelsPerBlock: 32 })).toEqual({
      width: 1,
      height: 2,
      pixelsPerBlock: 16,
    })
    expect(thumbnailSpec({ width: 2, height: 2, pixelsPerBlock: 4 })).toEqual({
      width: 2,
      height: 2,
      pixelsPerBlock: 4,
    })
  })
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
