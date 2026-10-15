import { describe, expect, it } from 'vitest'
import { SHAPE_IDS, type ShapeId } from '../domain/types.ts'
import { hashString, makeShapeContext, mulberry32, SHAPES, type Classified } from './shapes.ts'

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
  it('rose panes cycle through the first four tints like the prototype', () => {
    const tints = new Set<string>()
    for (let y = 0.5; y < 64; y++)
      for (let x = 0.5; x < 64; x++) {
        const t = SHAPES.rose(x, y, ctx).tint
        if (t) tints.add(t.join())
      }
    expect(tints).toEqual(new Set(['200,50,70', '50,100,210', '240,170,50', '40,160,100']))
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

describe('wooden bars are half the frame thickness', () => {
  const PPB = 64
  /** Pixels of `kind` along a run of pixel centres, from `from` to `to` (exclusive). */
  const run = (classify: (i: number) => Classified, from: number, to: number) => {
    let n = 0
    for (let i = from; i < to; i++) if (classify(i + 0.5).kind === 'frame') n++
    return n
  }

  /** The owner's rule: inner wooden bars are half the frame, at least 1 px (none at 0). */
  const barOf = (t: number) => (t > 0 ? Math.max(1, Math.round(t / 2)) : 0)
  const THICKNESSES = [1, 2, 3, 6, 8, 12]

  it.each(THICKNESSES)('four_panes cross bars are half of %i px', (t) => {
    // An even and an odd height, so a bar is centred both on a pixel edge and on a pixel.
    for (const h of [256, 191]) {
      const ctx = makeShapeContext(256, h, PPB, t, 1)
      // Across the vertical bar, and across the horizontal one, far from the outer frame.
      expect(
        run((x) => SHAPES.four_panes(x, 40.5, ctx), 64, 192),
        `${h}`,
      ).toBe(barOf(t))
      expect(
        run((y) => SHAPES.four_panes(40.5, y, ctx), 48, 144),
        `${h}`,
      ).toBe(barOf(t))
    }
  })

  it.each(THICKNESSES)('paper_screen grid bars are half of %i px', (t) => {
    const ctx = makeShapeContext(256, 256, PPB, t, 1)
    // Grid lines every 32 px (half a block): 48..80 crosses only the one at 64; 80 is clear.
    const lightRun = (classify: (i: number) => Classified) => {
      let n = 0
      for (let i = 48; i < 80; i++) if (classify(i + 0.5).light) n++
      return n
    }
    expect(lightRun((x) => SHAPES.paper_screen(x, 80.5, ctx))).toBe(barOf(t))
    expect(lightRun((y) => SHAPES.paper_screen(80.5, y, ctx))).toBe(barOf(t))
  })

  it.each([2, 3, 4, 7, 8])('paper_screen first and last panes are as wide at %i px', (t) => {
    // 2×2 blocks at 32 px per block: grid lines every 16 px, at 16, 32 and 48.
    const ctx = makeShapeContext(64, 64, 32, t, 1)
    const panes = (classify: (i: number) => Classified) => {
      const widths: number[] = []
      let n = 0
      for (let i = 0; i <= 64; i++) {
        if (i < 64 && classify(i + 0.5).paper) n++
        else if (n > 0) {
          widths.push(n)
          n = 0
        }
      }
      return widths
    }
    for (const at of [8.5, 24.5, 40.5, 56.5]) {
      const row = panes((x) => SHAPES.paper_screen(x, at, ctx))
      const column = panes((y) => SHAPES.paper_screen(at, y, ctx))
      for (const widths of [row, column]) {
        if (widths.length === 0) continue
        expect(widths, `${at}`).toHaveLength(4)
        expect(widths[0], `${at}`).toBe(widths[3])
        // An odd bar on the middle line cannot be centred: one inner pane gets the extra pixel.
        expect(Math.abs((widths[1] ?? 0) - (widths[2] ?? 0)), `${at}`).toBe(barOf(t) % 2)
      }
    }
  })

  it.each(THICKNESSES)('fanlight spokes are half of %i px', (t) => {
    const ctx = makeShapeContext(256, 128, PPB, t, 1)
    // The spoke at 3π/7 from the right, 80 px from the hub's centre (128, 128).
    const a = (3 * Math.PI) / 7
    const [cx, cy] = [128 + 80 * Math.cos(a), 128 - 80 * Math.sin(a)]
    // Its width across, sampled finely along the perpendicular.
    let inside = 0
    const step = 0.01
    for (let s = -20; s < 20; s += step) {
      const kind = SHAPES.fanlight(cx + s * Math.sin(a), cy + s * Math.cos(a), ctx).kind
      if (kind === 'frame') inside += step
    }
    expect(inside).toBeCloseTo(barOf(t), 1)
    // And in pixels, along the row through it (a near-vertical spoke: a little wider).
    const row = Math.floor(cy) + 0.5
    const across = run((x) => SHAPES.fanlight(x, row, ctx), 128, 180)
    expect(Math.abs(across - barOf(t))).toBeLessThanOrEqual(1)
  })

  it.each(['four_panes', 'paper_screen', 'fanlight'] as const)(
    '%s has no wooden bars (nor hub) without a frame',
    (id) => {
      const ctx = makeShapeContext(256, 128, PPB, 0, 1)
      for (let y = 0.5; y < 128; y++)
        for (let x = 0.5; x < 256; x++) expect(SHAPES[id](x, y, ctx).kind).not.toBe('frame')
    },
  )

  it('keeps the fanlight hub solid wood when there is a frame', () => {
    const ctx = makeShapeContext(256, 128, PPB, 2, 1)
    expect(SHAPES.fanlight(128.5, 110.5, ctx).kind).toBe('frame')
  })

  it.each(['gothic_arch', 'rose', 'stained_glass', 'leaded_diamonds'] as const)(
    '%s lead lines keep their own width at any thickness',
    (id) => {
      const thin = makeShapeContext(256, 256, PPB, 2, 3)
      const thick = makeShapeContext(256, 256, PPB, 12, 3)
      for (let y = 0.5; y < 256; y++)
        for (let x = 0.5; x < 256; x++) {
          const a = SHAPES[id](x, y, thin)
          const b = SHAPES[id](x, y, thick)
          // Away from the outer frame, the leads are the same at both thicknesses.
          if (a.kind !== 'frame' && b.kind !== 'frame' && a.kind !== 'out') expect(b).toBe(a)
        }
    },
  )

  it('the gothic arch mullion stays as wide as a lead', () => {
    for (const t of [2, 12]) {
      const ctx = makeShapeContext(256, 256, PPB, t, 1)
      let n = 0
      for (let x = 0; x < 256; x++) if (SHAPES.gothic_arch(x + 0.5, 200.5, ctx).kind === 'lead') n++
      expect(n).toBe(ctx.lead)
    }
  })
})
