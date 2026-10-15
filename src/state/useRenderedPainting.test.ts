import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createPainting } from '../domain/library.ts'
import { createEditLayer } from '../imaging/edits.ts'
import { renderPainting } from '../imaging/pipeline.ts'
import { createRaster, setPixel } from '../imaging/raster.ts'
import { pencil } from '../imaging/tools.ts'
import { transparentShare } from '../imaging/window.ts'
import { useEditor } from './editor.ts'
import {
  beginStroke,
  cachedRender,
  currentRaster,
  endStroke,
  previewStroke,
  useRenderedPainting,
} from './useRenderedPainting.ts'

const p0 = createPainting(
  { title: 'Hook', width: 1, height: 1, pixelsPerBlock: 16 },
  new Date(0),
  () => 0.5,
)
const painting = {
  ...p0,
  recipe: {
    ...p0.recipe,
    source: { imageId: 'img', width: 16, height: 16 },
    frame: { material: 'gilded' as const, thickness: 2 },
  },
}

function picture() {
  const r = createRaster(16, 16)
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) setPixel(r, x, y, [x * 15, y * 15, 90, 255])
  return r
}

const expected = () => {
  const { painting: p, source, edits } = useEditor.getState()
  if (!p) throw new Error('no painting')
  return renderPainting(source, edits, p)
}

describe('useRenderedPainting', () => {
  afterEach(() => {
    endStroke()
    act(() => useEditor.getState().close())
  })

  it('shows the render of the open painting and follows its changes', () => {
    act(() => useEditor.getState().open(painting, picture(), null))
    const { result } = renderHook(() => useRenderedPainting())
    expect(result.current.raster?.data).toEqual(expected().data)
    expect(result.current.transparent).toBeCloseTo(transparentShare(expected()))
    act(() =>
      useEditor.getState().change((p) => ({
        ...p,
        recipe: { ...p.recipe, window: { shape: 'oculus', glassOpacity: 0.5 } },
      })),
    )
    expect(result.current.raster?.data).toEqual(expected().data)
    expect(result.current.transparent).toBeCloseTo(transparentShare(expected()))
  })

  it('draws a stroke over the last render without rendering, exactly as a render would', () => {
    act(() => useEditor.getState().open(painting, picture(), null))
    const { result } = renderHook(() => useRenderedPainting())
    const before = result.current.raster
    act(() => beginStroke())
    // An eraser line (see-through: frame colour, R12) then a pencil line over it.
    const erased = pencil(
      createEditLayer(16, 16),
      [
        [2, 3],
        [9, 3],
      ],
      [0, 0, 0, 0],
    )
    act(() => {
      useEditor.getState().setEdits(erased)
      previewStroke(erased, { x0: 2, y0: 3, x1: 9, y1: 3 })
    })
    const painted = pencil(
      erased,
      [
        [5, 1],
        [5, 8],
      ],
      [10, 200, 30, 255],
    )
    act(() => {
      useEditor.getState().setEdits(painted)
      previewStroke(painted, { x0: 5, y0: 1, x1: 5, y1: 8 })
    })
    const preview = result.current.raster
    expect(preview).not.toBe(before)
    expect(preview?.data).toEqual(expected().data)
    expect(result.current.transparent).toBeCloseTo(transparentShare(expected()))
    // The tools pick from the preview: it is the current painting, no render needed.
    expect(currentRaster()).toBe(preview)
    // The render that was on screen is left untouched.
    expect(before?.data).toEqual(
      renderPainting(picture(), null, useEditor.getState().painting ?? painting).data,
    )
    act(() => endStroke())
    expect(result.current.raster).not.toBe(preview)
    expect(result.current.raster?.data).toEqual(expected().data)
  })

  it('forgets the render when the editor closes', () => {
    act(() => useEditor.getState().open(painting, picture(), null))
    renderHook(() => useRenderedPainting())
    expect(cachedRender()).not.toBeNull()
    act(() => useEditor.getState().close())
    expect(cachedRender()).toBeNull()
  })
})
