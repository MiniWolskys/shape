import { describe, expect, it } from 'vitest'
import { SHAPE_IDS, type ShapeId } from '../domain/types.ts'
import { hashString, makeShapeContext, mulberry32, SHAPES } from './shapes.ts'

describe('shapes', () => {
  const ctx = makeShapeContext(64, 64, 32, 4, 1)
  it.each(SHAPE_IDS)('%s keeps the centre visible', (id) =>
    expect(SHAPES[id](32.5, 33.5, ctx).kind).not.toBe('out'),
  )
  it.each(
    SHAPE_IDS.filter(
      (s) =>
        s !== 'full' &&
        s !== 'four_panes' &&
        s !== 'leaded_diamonds' &&
        s !== 'stained_glass' &&
        s !== 'paper_screen',
    ),
  )('%s cuts the top-left corner', (id) => expect(SHAPES[id](0.5, 0.5, ctx).kind).toBe('out'))
  it('full painting has a frame border and nothing out', () => {
    expect(SHAPES.full(0.5, 32.5, ctx).kind).toBe('frame')
    expect(SHAPES.full(10.5, 10.5, ctx).kind).toBe('glass')
  })
  it('no frame when thickness is 0', () =>
    expect(SHAPES.full(0.5, 32.5, makeShapeContext(64, 64, 32, 0, 1)).kind).toBe('glass'))
  it('derives lead width and stained-glass cells from the painting', () => {
    expect(ctx.lead).toBe(4)
    expect(ctx.frame).toBe(4)
    expect(ctx.cells).toHaveLength(20)
    expect(makeShapeContext(16, 16, 16, 1, 1).cells).toHaveLength(6)
    expect(makeShapeContext(16, 16, 8, 1, 1).lead).toBe(2)
  })
  it('stained glass matches a brute-force nearest-cell search', () => {
    const big = makeShapeContext(256, 128, 32, 2, 7)
    for (let y = 2.5; y < 126; y += 3) {
      for (let x = 2.5; x < 254; x += 3) {
        let d1 = Infinity
        let d2 = Infinity
        for (const [cx, cy] of big.cells) {
          const d = Math.hypot(x - cx, y - cy)
          if (d < d1) {
            d2 = d1
            d1 = d
          } else if (d < d2) d2 = d
        }
        expect(SHAPES.stained_glass(x, y, big).kind).toBe(
          d2 - d1 < big.lead * 0.75 ? 'lead' : 'glass',
        )
      }
    }
  })
  it('decorates glass and frames per shape', () => {
    const features = (id: ShapeId) => {
      const seen = new Set<string>()
      for (let y = 0.5; y < 64; y++)
        for (let x = 0.5; x < 64; x++) {
          const c = SHAPES[id](x, y, ctx)
          seen.add(c.kind)
          if (c.tint) seen.add('tint')
          if (c.paper) seen.add('paper')
          if (c.light) seen.add('light')
          if (c.rivet) seen.add('rivet')
        }
      return seen
    }
    expect(features('rose')).toEqual(new Set(['out', 'frame', 'lead', 'glass', 'tint']))
    expect(features('paper_screen')).toEqual(new Set(['frame', 'glass', 'paper', 'light']))
    expect(features('porthole').has('rivet')).toBe(true)
    expect(features('leaded_diamonds').has('lead')).toBe(true)
  })
})

describe('seeded helpers', () => {
  it('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
  it('hashString is FNV-1a 32-bit', () => {
    expect(hashString('')).toBe(0x811c9dc5)
    expect(hashString('a')).toBe(0xe40c292c)
    expect(hashString('foobar')).toBe(0xbf9cf968)
  })
})
