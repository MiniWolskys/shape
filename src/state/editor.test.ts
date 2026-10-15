import { beforeEach, describe, expect, it } from 'vitest'
import { ShapeError } from '../domain/errors.ts'
import { createPainting } from '../domain/library.ts'
import type { Painting } from '../domain/types.ts'
import { createEditLayer, type EditLayer } from '../imaging/edits.ts'
import { createRaster, getPixel } from '../imaging/raster.ts'
import { cachedPictureIds, HISTORY_BYTES, HISTORY_LIMIT, useEditor } from './editor.ts'

const now = new Date('2026-10-15T12:00:00Z')

function painting(over: Partial<Painting> = {}): Painting {
  return {
    ...createPainting({ title: 'Test', width: 2, height: 1, pixelsPerBlock: 16 }, now, () => 0.5),
    ...over,
  }
}

function editedLayer(width: number, height: number): EditLayer {
  const layer = createEditLayer(width, height)
  layer.mask[0] = 1
  layer.values.data.set([255, 0, 0, 255], 0)
  return layer
}

const state = () => useEditor.getState()
const title = () => state().painting?.title

describe('editor store', () => {
  beforeEach(() => {
    state().open(painting(), null, null)
  })

  it('opens a painting clean, with empty history', () => {
    expect(state().painting?.title).toBe('Test')
    expect(state().past).toEqual([])
    expect(state().future).toEqual([])
    expect(state().dirty).toBe(false)
  })

  it('undoes and redoes across change and setEdits', () => {
    state().change((p) => ({ ...p, title: 'One' }))
    const layer = editedLayer(32, 16)
    state().setEdits(layer)
    state().change((p) => ({ ...p, title: 'Two' }))
    expect(state().dirty).toBe(true)

    state().undo()
    expect(title()).toBe('One')
    expect(state().edits).toBe(layer)
    state().undo()
    expect(title()).toBe('One')
    expect(state().edits).toBeNull()
    state().undo()
    expect(title()).toBe('Test')
    expect(state().dirty).toBe(false)

    state().redo()
    state().redo()
    expect(state().edits).toBe(layer)
    state().redo()
    expect(title()).toBe('Two')
    expect(state().future).toEqual([])
  })

  it('drops the redo history on a new change', () => {
    state().change((p) => ({ ...p, title: 'One' }))
    state().undo()
    state().change((p) => ({ ...p, title: 'Other' }))
    expect(state().future).toEqual([])
    state().redo()
    expect(title()).toBe('Other')
  })

  it('ignores a change that returns the same painting', () => {
    state().change((p) => p)
    expect(state().past).toHaveLength(0)
    expect(state().dirty).toBe(false)
  })

  it('caps the history at 60 snapshots', () => {
    expect(HISTORY_LIMIT).toBe(60)
    for (let i = 1; i <= 75; i++) state().change((p) => ({ ...p, title: `T${i}` }))
    expect(state().past).toHaveLength(60)
    for (let i = 0; i < 80; i++) state().undo()
    expect(title()).toBe('T15')
  })

  it('merges consecutive changes with the same merge key into one step', () => {
    for (const brightness of [10, 20, 30]) {
      state().change(
        (p) => ({ ...p, recipe: { ...p.recipe, adjust: { ...p.recipe.adjust, brightness } } }),
        { merge: 'brightness' },
      )
    }
    expect(state().past).toHaveLength(1)
    expect(state().painting?.recipe.adjust.brightness).toBe(30)
    state().undo()
    expect(state().painting?.recipe.adjust.brightness).toBe(0)
  })

  it('setSource stores the picture and resets the crop to the centred crop', () => {
    state().change((p) => ({
      ...p,
      recipe: { ...p.recipe, crop: { x: 1, y: 1, width: 4, height: 2 } },
    }))
    const picture = createRaster(100, 80)
    state().setSource(picture, 'abc')
    expect(state().source).toBe(picture)
    expect(state().painting?.recipe.source).toEqual({ imageId: 'abc', width: 100, height: 80 })
    // 2:1 inside 100x80 is 100x50, centred vertically.
    expect(state().painting?.recipe.crop).toEqual({ x: 0, y: 15, width: 100, height: 50 })
  })

  it('undo of setSource brings back the previous picture', () => {
    const first = createRaster(10, 10)
    const second = createRaster(20, 20)
    state().setSource(first, 'first')
    state().setSource(second, 'second')
    state().undo()
    expect(state().source).toBe(first)
    state().undo()
    expect(state().source).toBeNull()
    state().redo()
    state().redo()
    expect(state().source).toBe(second)
  })

  it('resize resamples the edits to the new pixel size', () => {
    state().setEdits(editedLayer(32, 16))
    state().resize(4, 2, 16)
    const edits = state().edits
    expect(edits?.values.width).toBe(64)
    expect(edits?.values.height).toBe(32)
    // Pixel (0,0) was edited; at twice the size it covers a 2x2 square.
    expect(edits?.mask[0]).toBe(1)
    expect(edits?.mask[65]).toBe(1)
    expect(edits?.mask[2]).toBe(0)
    expect(edits && getPixel(edits.values, 1, 1)).toEqual([255, 0, 0, 255])
    expect(state().painting).toMatchObject({ width: 4, height: 2, pixelsPerBlock: 16 })
  })

  it('resize resets the crop on a size change and scales the frame thickness with the resolution', () => {
    state().change((p) => ({
      ...p,
      recipe: { ...p.recipe, crop: { x: 1, y: 1, width: 4, height: 2 } },
    }))
    state().resize(2, 1, 32)
    expect(state().painting?.recipe.crop).toEqual({ x: 1, y: 1, width: 4, height: 2 })
    expect(state().painting?.recipe.frame.thickness).toBe(4)
    state().resize(3, 1, 32)
    expect(state().painting?.recipe.crop).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    state().resize(3, 1, 1)
    expect(state().painting?.recipe.frame.thickness).toBe(1)
  })

  it('resize keeps a frame thickness of 0 at 0', () => {
    state().change((p) => ({
      ...p,
      recipe: { ...p.recipe, frame: { ...p.recipe.frame, thickness: 0 } },
    }))
    state().resize(2, 1, 64)
    expect(state().painting?.recipe.frame.thickness).toBe(0)
  })

  it('resize of a published painting throws published-locked and changes nothing', () => {
    state().open(painting({ status: 'published', publishedIn: 1 }), null, null)
    expect(() => state().resize(3, 3, 16)).toThrow(ShapeError)
    expect(state().painting).toMatchObject({ width: 2, height: 1 })
    expect(state().past).toHaveLength(0)
  })

  it('undo clears a selection that may no longer fit', () => {
    state().change((p) => ({ ...p, title: 'One' }))
    state().setSelection(new Uint8Array(32 * 16))
    state().undo()
    expect(state().selection).toBeNull()
  })

  it('markSaved makes the current state the clean one', () => {
    state().change((p) => ({ ...p, title: 'One' }))
    const saved = { ...(state().painting as Painting), updatedAt: '2026-10-16T00:00:00.000Z' }
    state().markSaved(saved)
    expect(state().dirty).toBe(false)
    expect(state().painting).toBe(saved)
    state().undo()
    expect(state().dirty).toBe(true)
    state().redo()
    expect(state().dirty).toBe(false)
  })

  it('keeps a saved edits id when undoing to edits made before it existed', () => {
    state().setEdits(editedLayer(32, 16))
    state().setEdits(editedLayer(32, 16))
    const p = state().painting as Painting
    state().markSaved({ ...p, recipe: { ...p.recipe, editsId: 'edits1' } })
    state().undo()
    expect(state().painting?.recipe.editsId).toBe('edits1')
  })

  it('close forgets the painting and its history', () => {
    state().change((p) => ({ ...p, title: 'One' }))
    state().close()
    expect(state().painting).toBeNull()
    expect(state().past).toEqual([])
    expect(state().dirty).toBe(false)
  })

  it('caps the history by the memory of its distinct edit layers', () => {
    expect(HISTORY_BYTES).toBe(64 * 1024 * 1024)
    // 1500 x 1500 pixels at 5 bytes each is about 10.7 MB per layer.
    const side = 1500
    const layers = Array.from({ length: 8 }, () => createEditLayer(side, side))
    for (const layer of layers) state().setEdits(layer)
    const distinct = new Set(
      [...state().past, ...state().future].map((s) => s.edits).concat(state().edits),
    )
    distinct.delete(null)
    expect(distinct.size * side * side * 5).toBeLessThanOrEqual(HISTORY_BYTES)
    expect(state().past.length).toBeLessThan(8)
    // The oldest entries go first: the newest layers are still reachable.
    state().undo()
    expect(state().edits).toBe(layers[6])
  })

  it('keeps only the pictures the history still refers to', () => {
    state().setSource(createRaster(4, 4), 'first')
    state().setSource(createRaster(4, 4), 'second')
    expect(cachedPictureIds().sort()).toEqual(['first', 'second'])
    for (let i = 0; i < HISTORY_LIMIT + 2; i++)
      state().change((p) => ({ ...p, title: 'T' + String(i) }))
    expect(cachedPictureIds()).toEqual(['second'])
  })

  it('setSource updates the picture and the painting in one store update', () => {
    let updates = 0
    const stop = useEditor.subscribe(() => updates++)
    state().setSource(createRaster(4, 4), 'pic')
    stop()
    expect(updates).toBe(1)
  })

  it('endGesture starts a new undo step for the same merge key', () => {
    const setBrightness = (brightness: number) =>
      state().change(
        (p) => ({ ...p, recipe: { ...p.recipe, adjust: { ...p.recipe.adjust, brightness } } }),
        { merge: 'brightness' },
      )
    setBrightness(10)
    setBrightness(20)
    state().endGesture()
    setBrightness(30)
    expect(state().past).toHaveLength(2)
  })

  it('undoing back to no edits also forgets the edits id', () => {
    state().setEdits(editedLayer(32, 16))
    const p = state().painting as Painting
    state().markSaved({ ...p, recipe: { ...p.recipe, editsId: 'edits1' } })
    state().undo()
    expect(state().edits).toBeNull()
    expect(state().painting?.recipe.editsId).toBeNull()
  })

  it('clamps zoom and tolerance', () => {
    state().setZoom(1000)
    expect(state().zoom).toBe(64)
    state().setZoom(-3)
    expect(state().zoom).toBe(0)
    state().setTolerance(140)
    expect(state().tolerance).toBe(100)
  })
})
