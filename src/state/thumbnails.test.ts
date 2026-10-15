import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPainting } from '../domain/library.ts'
import type { Painting } from '../domain/types.ts'
import { createRaster } from '../imaging/raster.ts'
import { encodePng } from '../packs/png.ts'
import { renderThumbnail, useThumbnail } from './thumbnails.ts'

const now = new Date('2026-10-15T12:00:00Z')

function painting(init: Partial<Painting> = {}): Painting {
  return { ...createPainting({ title: 'Test' }, now, () => 0.4), ...init }
}

describe('renderThumbnail', () => {
  it('keeps paintings at 16 pixels per block or less at their own size', () => {
    const p = painting({ width: 2, height: 1, pixelsPerBlock: 8 })
    const r = renderThumbnail(p, {})
    expect([r.width, r.height]).toEqual([16, 8])
  })

  it('downscales finer paintings to 16 pixels per block', () => {
    const p = painting({ width: 3, height: 2, pixelsPerBlock: 64 })
    const r = renderThumbnail(p, {})
    expect([r.width, r.height]).toEqual([48, 32])
  })

  it('draws the source picture from the workspace assets', () => {
    const p0 = painting({ width: 1, height: 1, pixelsPerBlock: 16 })
    const p = { ...p0, recipe: { ...p0.recipe, source: { imageId: 'img', width: 4, height: 4 } } }
    const r = renderThumbnail(p, { img: encodePng(createRaster(4, 4, [0, 200, 0, 255])) })
    // The centre is inside the frame, so it shows the green picture.
    const i = (8 * 16 + 8) * 4
    expect([...r.data.slice(i, i + 4)]).toEqual([0, 200, 0, 255])
  })
})

describe('useThumbnail', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is null until the idle render runs, then returns the thumbnail', () => {
    const p = painting({ id: 'hook_test', width: 1, height: 1, pixelsPerBlock: 32 })
    const { result } = renderHook(() => useThumbnail(p))
    expect(result.current).toBeNull()
    act(() => {
      vi.runAllTimers()
    })
    expect(result.current?.width).toBe(16)
  })

  it('reuses the cached thumbnail while the painting is unchanged', () => {
    const p = painting({ id: 'cached_test', width: 1, height: 1, pixelsPerBlock: 16 })
    const first = renderHook(() => useThumbnail(p))
    act(() => {
      vi.runAllTimers()
    })
    const raster = first.result.current
    first.unmount()
    const second = renderHook(() => useThumbnail(p))
    expect(second.result.current).toBe(raster)
    const changed = renderHook(() => useThumbnail({ ...p, updatedAt: '2026-10-16T00:00:00Z' }))
    expect(changed.result.current).toBeNull()
  })
})
