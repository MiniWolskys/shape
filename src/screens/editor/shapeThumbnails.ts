import { useEffect, useState } from 'react'
import { SHAPE_IDS, type Painting, type ShapeId } from '../../domain/types.ts'
import { createStagedRenderer } from '../../imaging/pipeline.ts'
import type { Raster } from '../../imaging/raster.ts'
import { hashString, makeShapeContext, SHAPES } from '../../imaging/shapes.ts'
import { applyWindow } from '../../imaging/window.ts'
import { useEditor } from '../../state/editor.ts'
import { outlinePath } from './pixelTools.ts'

/**
 * Thumbnails show the painting at most this many blocks on a side, at up to 16 px per block: a
 * big painting's lead lines would be noise at a few pixels per block (I9).
 */
const THUMB_BLOCKS = 2
const THUMB_MAX_PPB = 16
const CACHE_LIMIT = SHAPE_IDS.length * 6
/** Shape icons, shown until a thumbnail is drawn: pixels per side and per block. */
const ICON_PIXELS = 24
const ICON_PPB = 12

/** Shape thumbnails by `${pictureKey}|${shape}`, oldest first. */
const cache = new Map<string, Raster>()

/** Keeps the turned and resized picture, so a new glass or frame does not redo them. */
const pictures = createStagedRenderer()
useEditor.subscribe((state) => {
  if (!state.painting) pictures.clear()
})

/** Stable ids for pictures, so a key can name one without hashing its pixels. */
const pictureIds = new WeakMap<Raster, number>()
let nextPictureId = 1

function pictureId(source: Raster | null): number {
  if (!source) return 0
  let id = pictureIds.get(source)
  if (id === undefined) {
    id = nextPictureId++
    pictureIds.set(source, id)
  }
  return id
}

/**
 * The size a painting's shape thumbnails are drawn at: the painting scaled down to fit
 * 2×2 blocks (smaller ones stay whole), at 16 px per block or the painting's own if fewer. The
 * shape is drawn for that size, so its leads have the density they have per block in the game.
 */
export function thumbnailSpec(
  p: Pick<Painting, 'width' | 'height' | 'pixelsPerBlock'>,
): Pick<Painting, 'width' | 'height' | 'pixelsPerBlock'> {
  const k = Math.min(1, THUMB_BLOCKS / Math.max(p.width, p.height))
  return {
    width: Math.max(1, Math.round(p.width * k)),
    height: Math.max(1, Math.round(p.height * k)),
    pixelsPerBlock: Math.min(THUMB_MAX_PPB, p.pixelsPerBlock),
  }
}

export interface ShapeIcon {
  /** SVG path data of the shape's edge, in a ICON_PIXELS-wide box. */
  outline: string
  /** SVG path data around its lead lines and bars. */
  lead: string
  size: number
}

const icons = new Map<ShapeId, ShapeIcon>()

/**
 * A small line drawing of a shape, made from the shape itself: shown at once on every tile,
 * until the thumbnail of the painting with that shape is drawn.
 */
export function shapeIcon(shape: ShapeId): ShapeIcon {
  const known = icons.get(shape)
  if (known) return known
  const size = ICON_PIXELS
  const ctx = makeShapeContext(size, size, ICON_PPB, 2, 1)
  const inside = new Uint8Array(size * size)
  const lead = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const kind = SHAPES[shape](x + 0.5, y + 0.5, ctx).kind
      inside[y * size + x] = kind === 'out' ? 0 : 1
      lead[y * size + x] = kind === 'lead' ? 1 : 0
    }
  }
  const icon = {
    outline: outlinePath(inside, size, size),
    lead: outlinePath(lead, size, size),
    size,
  }
  icons.set(shape, icon)
  return icon
}

/**
 * What the thumbnails depend on: the picture and everything in the recipe except the shape
 * being previewed and the pixel edits (which belong to the real shape only).
 */
function keyOf(p: Painting, source: Raster | null): string {
  const { editsId: _edits, window: shaped, ...rest } = p.recipe
  return JSON.stringify([
    pictureId(source),
    p.id,
    p.width,
    p.height,
    p.pixelsPerBlock,
    shaped.glassOpacity,
    rest,
  ])
}

function renderShape(picture: Raster, p: Painting, shape: ShapeId): Raster {
  const ppb = thumbnailSpec(p).pixelsPerBlock
  const { thickness, material } = p.recipe.frame
  return applyWindow(picture, {
    shape,
    glassOpacity: p.recipe.window.glassOpacity,
    material,
    // Thickness is in pixels at the painting's resolution: it shrinks with the thumbnail.
    thickness: thickness === 0 ? 0 : Math.max(1, Math.round((thickness * ppb) / p.pixelsPerBlock)),
    pixelsPerBlock: ppb,
    seed: hashString(p.id),
  })
}

function store(key: string, raster: Raster) {
  cache.set(key, raster)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

type Cancel = () => void

/** Runs `task` when the browser is idle, or soon without requestIdleCallback. */
function whenIdle(task: () => void): Cancel {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(task, { timeout: 500 })
    return () => window.cancelIdleCallback(handle)
  }
  const handle = setTimeout(task, 0)
  return () => clearTimeout(handle)
}

/**
 * A small render of the open painting with each window shape, from its own picture. They are
 * drawn one per idle slot, so typing and slider drags never wait for them, and kept by picture
 * and recipe so going back to the step shows them at once.
 */
export function useShapeThumbnails(): Partial<Record<ShapeId, Raster>> {
  const painting = useEditor((s) => s.painting)
  const source = useEditor((s) => s.source)
  const key = painting ? keyOf(painting, source) : null
  const [, setDrawn] = useState(0)

  useEffect(() => {
    if (key === null) return
    const missing = SHAPE_IDS.filter((shape) => !cache.has(`${key}|${shape}`))
    if (missing.length === 0) return
    let picture: Raster | null = null
    let cancel: Cancel = () => {}
    const step = () => {
      const { painting: p, source: s } = useEditor.getState()
      const shape = missing.shift()
      // A newer painting state has its own key and its own run.
      if (!p || !shape || keyOf(p, s) !== key) return
      try {
        picture ??= pictures.picture(s, { ...p, ...thumbnailSpec(p) })
        store(`${key}|${shape}`, renderShape(picture, p, shape))
        setDrawn((n) => n + 1)
      } catch (error) {
        // That shape stays blank; the others still get drawn.
        console.error(`Could not draw the ${shape} thumbnail`, error)
      }
      if (missing.length > 0) cancel = whenIdle(step)
    }
    cancel = whenIdle(step)
    return () => cancel()
  }, [key])

  const out: Partial<Record<ShapeId, Raster>> = {}
  if (key !== null) {
    for (const shape of SHAPE_IDS) {
      const raster = cache.get(`${key}|${shape}`)
      if (raster) out[shape] = raster
    }
  }
  return out
}
