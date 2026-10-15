import { describe, expect, it } from 'vitest'
import { createPainting } from '../domain/library.ts'
import type { Painting, Recipe } from '../domain/types.ts'
import { adjust } from './adjust.ts'
import {
  applyEdits,
  createEditLayer,
  isEmptyLayer,
  resampleEdits,
  type EditLayer,
} from './edits.ts'
import { FRAME_MATERIALS } from './materials.ts'
import { createStagedRenderer, renderPainting, type TextureSpec } from './pipeline.ts'
import { quantize } from './quantize.ts'
import { createRaster, setPixel, type Raster } from './raster.ts'
import { resample } from './resample.ts'
import { hashString } from './shapes.ts'
import { centeredCrop, crop, flip, rotate } from './transform.ts'
import { applyWindow } from './window.ts'

/** The pipeline exactly as it was before it was split into stages: the oracle. */
function reference(source: Raster | null, edits: EditLayer | null, p: TextureSpec): Raster {
  const { recipe } = p
  const width = p.width * p.pixelsPerBlock
  const height = p.height * p.pixelsPerBlock
  let picture: Raster
  if (!source) {
    const cell = Math.max(1, Math.round(p.pixelsPerBlock / 4))
    picture = createRaster(width, height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const even = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0
        picture.data.set(even ? [110, 110, 114, 255] : [92, 92, 96, 255], (y * width + x) * 4)
      }
    }
  } else {
    const turned = flip(rotate(source, recipe.rotation), recipe.flipX, recipe.flipY)
    const { x, y, width: cw, height: ch } = recipe.crop
    const fits =
      cw > 0 && ch > 0 && x >= 0 && y >= 0 && x + cw <= turned.width && y + ch <= turned.height
    const rect = fits ? recipe.crop : centeredCrop(turned.width, turned.height, p.width, p.height)
    const sized = resample(crop(turned, rect), width, height, recipe.scaling)
    const adjusted = adjust(sized, recipe.adjust)
    picture = recipe.mcLook.enabled ? quantize(adjusted, recipe.mcLook) : adjusted
  }
  let out = applyWindow(picture, {
    shape: recipe.window.shape,
    glassOpacity: recipe.window.glassOpacity,
    material: recipe.frame.material,
    thickness: recipe.frame.thickness,
    pixelsPerBlock: p.pixelsPerBlock,
    seed: hashString(p.id),
  })
  if (edits && !isEmptyLayer(edits)) {
    const sized =
      edits.values.width === out.width && edits.values.height === out.height
        ? edits
        : resampleEdits(edits, out.width, out.height)
    out = applyEdits(out, sized)
  }
  const [fr, fg, fb] = FRAME_MATERIALS[recipe.frame.material].color
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i + 3] !== 0) continue
    out.data[i] = fr
    out.data[i + 1] = fg
    out.data[i + 2] = fb
  }
  return out
}

const base: Painting = {
  ...createPainting(
    { title: 'Staged', width: 2, height: 1, pixelsPerBlock: 8 },
    new Date(0),
    () => 0.25,
  ),
}

function source(w = 40, h = 30): Raster {
  const r = createRaster(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      setPixel(r, x, y, [(x * 7) % 256, (y * 9) % 256, (x * y) % 256, x === 3 && y === 4 ? 0 : 255])
    }
  }
  return r
}

function editsFor(w: number, h: number): EditLayer {
  const layer = createEditLayer(w, h)
  for (const [x, y, c] of [
    [1, 1, [255, 255, 0, 255]],
    [2, 3, [0, 0, 0, 0]],
    [5, 2, [10, 200, 30, 120]],
  ] as const) {
    setPixel(layer.values, x, y, c)
    layer.mask[y * w + x] = 1
  }
  return layer
}

type Variation = [name: string, patch: (p: Painting) => Painting]
const recipe = (patch: Partial<Recipe>) => (p: Painting) => ({
  ...p,
  recipe: { ...p.recipe, ...patch },
})

const VARIATIONS: Variation[] = [
  ['rotation 90', recipe({ rotation: 90 })],
  ['rotation 180', recipe({ rotation: 180 })],
  ['rotation 270', recipe({ rotation: 270 })],
  ['flip x', recipe({ flipX: true })],
  ['flip y', recipe({ flipY: true })],
  ['crop', recipe({ crop: { x: 2, y: 3, width: 20, height: 10 } })],
  ['smooth', recipe({ scaling: 'smooth' })],
  ['size', (p) => ({ ...p, width: 1, height: 2 })],
  ['pixels per block', (p) => ({ ...p, pixelsPerBlock: 6 })],
  ['brightness', recipe({ adjust: { brightness: 30, contrast: 0, saturation: 0 } })],
  ['contrast', recipe({ adjust: { brightness: 0, contrast: -40, saturation: 0 } })],
  ['saturation', recipe({ adjust: { brightness: 0, contrast: 0, saturation: 60 } })],
  ['look', recipe({ mcLook: { enabled: true, colors: 6, palette: 'auto', dither: false } })],
  ['look dither', recipe({ mcLook: { enabled: true, colors: 6, palette: 'auto', dither: true } })],
  [
    'look blocks',
    recipe({ mcLook: { enabled: true, colors: 6, palette: 'blocks', dither: true } }),
  ],
  ['shape rose', recipe({ window: { shape: 'rose', glassOpacity: 1 } })],
  ['shape paper', recipe({ window: { shape: 'paper_screen', glassOpacity: 1 } })],
  ['glass', recipe({ window: { shape: 'gothic_arch', glassOpacity: 0.5 } })],
  ['material none', recipe({ frame: { material: 'none', thickness: 2 } })],
  ['material gilded', recipe({ frame: { material: 'gilded', thickness: 3 } })],
  ['thickness 0', recipe({ frame: { material: 'oak', thickness: 0 } })],
  ['id (seed)', (p) => ({ ...p, id: 'another_one' })],
]

describe('staged renderer', () => {
  it('matches the unstaged pipeline for every variation, in any order', () => {
    const src = source()
    const staged = createStagedRenderer()
    let p = base
    for (const [name, patch] of VARIATIONS) {
      // Each variation alone from the base, then piled on top of the previous ones.
      for (const candidate of [patch(base), (p = patch(p))]) {
        const edits = editsFor(candidate.width * candidate.pixelsPerBlock, 8)
        for (const [s, e] of [
          [src, null],
          [src, edits],
          [null, null],
        ] as const) {
          expect(staged.render(s, e, candidate).data, name).toEqual(reference(s, e, candidate).data)
        }
      }
    }
  })

  it('renderPainting matches the unstaged pipeline', () => {
    const src = source()
    for (const [name, patch] of VARIATIONS) {
      const p = patch(base)
      const edits = editsFor(16, 8)
      expect(renderPainting(src, edits, p).data, name).toEqual(reference(src, edits, p).data)
    }
  })

  it('returns a fresh raster every time, so callers may keep or transfer it', () => {
    const src = source()
    const staged = createStagedRenderer()
    const a = staged.render(src, null, base)
    a.data.fill(7)
    const b = staged.render(src, null, base)
    expect(b.data).not.toBe(a.data)
    expect(b.data).toEqual(reference(src, null, base).data)
  })

  it('after prefetching, other shapes and thicknesses need no new classification', () => {
    const src = source()
    const staged = createStagedRenderer()
    staged.render(src, null, base)
    for (const _ of staged.prefetch(base)) {
      // Run the background work to its end.
    }
    const before = staged.computed.shaped
    let p = base
    for (const shape of ['rose', 'oculus', 'stained_glass'] as const) {
      p = recipe({ window: { shape, glassOpacity: 1 } })(base)
      expect(staged.render(src, null, p).data).toEqual(reference(src, null, p).data)
    }
    expect(staged.computed.shaped).toBe(before)
    // The current shape at any thickness up to the bound comes from its edge.
    for (const thickness of [0, 1, 4, 9]) {
      p = recipe({ frame: { material: 'oak', thickness } })(base)
      expect(staged.render(src, null, p).data).toEqual(reference(src, null, p).data)
    }
    expect(staged.computed.shaped).toBe(before)
  })

  it.each(['fanlight', 'four_panes', 'paper_screen'] as const)(
    '%s wooden bars from the cache match a fresh render across thicknesses',
    (shape) => {
      const src = source()
      const staged = createStagedRenderer()
      const big = recipe({ window: { shape, glassOpacity: 1 } })({
        ...base,
        width: 2,
        height: 2,
        pixelsPerBlock: 32,
      })
      staged.render(src, null, big)
      for (const _ of staged.prefetch(big)) {
        // Run the background work to its end.
      }
      for (const thickness of [0, 1, 4, 16, 24, 4, 0]) {
        const p = recipe({ frame: { material: 'oak', thickness } })(big)
        expect(staged.render(src, null, p).data, `${thickness}`).toEqual(
          reference(src, null, p).data,
        )
      }
    },
  )

  it('four_panes bars are half the frame through the cache', () => {
    const src = source()
    const staged = createStagedRenderer()
    const big = recipe({ window: { shape: 'four_panes', glassOpacity: 1 } })({
      ...base,
      width: 4,
      height: 4,
      pixelsPerBlock: 32,
    })
    for (const _ of staged.prefetch(big)) {
      // The edge first, so thicknesses come from reframing.
    }
    for (const thickness of [2, 12, 16]) {
      const p = recipe({ frame: { material: 'oak', thickness } })(big)
      const out = staged.render(src, null, p)
      // Across the vertical bar at row 32: opaque wood where the picture shows elsewhere.
      let wood = 0
      for (let x = 32; x < 96; x++) {
        const i = (32 * out.width + x) * 4
        const [r, g, b] = FRAME_MATERIALS.oak.color
        if (
          Math.abs((out.data[i] ?? 0) - r) <= 9 &&
          Math.abs((out.data[i + 1] ?? 0) - g) <= 9 &&
          Math.abs((out.data[i + 2] ?? 0) - b) <= 9 &&
          out.data[i + 3] === 255
        )
          wood++
      }
      expect(wood, `${thickness}`).toBe(Math.max(1, Math.round(thickness / 2)))
    }
  })

  describe('reuses the stages a change does not reach', () => {
    const src = source()
    const edits = editsFor(16, 8)
    const counts = (patch: (p: Painting) => Painting, nextEdits: EditLayer | null = edits) => {
      const staged = createStagedRenderer()
      staged.render(src, edits, base)
      const before = { ...staged.computed }
      staged.render(src, nextEdits, patch(base))
      const after = staged.computed
      return Object.fromEntries(
        Object.entries(after).map(([k, v]) => [k, v - (before[k as keyof typeof before] ?? 0)]),
      )
    }
    const window = {
      turned: 0,
      sized: 0,
      adjusted: 0,
      looked: 0,
      shaped: 0,
      windowed: 1,
      edited: 1,
    }

    it('glass and material only repaint the window over the same shape', () => {
      expect(counts(recipe({ window: { shape: 'full', glassOpacity: 0.4 } }))).toEqual(window)
      expect(counts(recipe({ frame: { material: 'iron', thickness: 2 } }))).toEqual(window)
    })

    it('shape and thickness classify the shape again, and nothing before it', () => {
      const shaped = { ...window, shaped: 1 }
      expect(counts(recipe({ window: { shape: 'rose', glassOpacity: 1 } }))).toEqual(shaped)
      expect(counts(recipe({ frame: { material: 'dark_oak', thickness: 5 } }))).toEqual(shaped)
      expect(counts(recipe({ frame: { material: 'none', thickness: 2 } }))).toEqual(shaped)
    })

    it('new edits only redo the edits', () => {
      expect(counts((p) => p, editsFor(16, 8))).toEqual({ ...window, windowed: 0 })
    })

    it('a new title or status redoes nothing but the final pass', () => {
      expect(counts((p) => ({ ...p, title: 'Renamed', status: 'draft' }))).toEqual({
        ...window,
        windowed: 0,
        edited: 0,
      })
    })

    it('picture adjustments keep the turned and resized picture', () => {
      const adjusted = { ...window, adjusted: 1, looked: 1 }
      expect(counts(recipe({ adjust: { brightness: 20, contrast: 0, saturation: 0 } }))).toEqual(
        adjusted,
      )
      const look = recipe({ mcLook: { enabled: true, colors: 8, palette: 'auto', dither: false } })
      expect(counts(look)).toEqual({ ...window, looked: 1 })
    })

    it('a crop keeps the turned picture; a rotation redoes it', () => {
      const all = { turned: 1, sized: 1, adjusted: 1, looked: 1, shaped: 0, windowed: 1, edited: 1 }
      expect(counts(recipe({ crop: { x: 1, y: 1, width: 30, height: 15 } }))).toEqual({
        ...all,
        turned: 0,
      })
      expect(counts(recipe({ rotation: 180 }))).toEqual(all)
    })
  })
})
