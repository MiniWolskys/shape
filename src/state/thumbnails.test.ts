import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPainting } from '../domain/library.ts'
import type { Painting } from '../domain/types.ts'
import { renderPainting } from '../imaging/pipeline.ts'
import { createRaster } from '../imaging/raster.ts'
import { encodePng } from '../packs/png.ts'
import {
  renderThumbnail,
  THUMBNAIL_CACHE_SIZE,
  thumbnailCacheSize,
  useThumbnail,
} from './thumbnails.ts'

vi.mock('../imaging/pipeline.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../imaging/pipeline.ts')>()
  return { ...actual, renderPainting: vi.fn(actual.renderPainting) }
})

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
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(renderPainting).mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders one thumbnail per idle slot', () => {
    const a = painting({ id: 'serial_a', width: 1, height: 1, pixelsPerBlock: 16 })
    const b = painting({ id: 'serial_b', width: 1, height: 1, pixelsPerBlock: 16 })
    const first = renderHook(() => useThumbnail(a))
    const second = renderHook(() => useThumbnail(b))
    act(() => {
      vi.advanceTimersToNextTimer()
    })
    expect(renderPainting).toHaveBeenCalledTimes(1)
    expect(first.result.current).not.toBeNull()
    expect(second.result.current).toBeNull()
    act(() => {
      vi.advanceTimersToNextTimer()
    })
    expect(renderPainting).toHaveBeenCalledTimes(2)
    expect(second.result.current).not.toBeNull()
  })

  it('skips the render when the card unmounts before its turn', () => {
    const p = painting({ id: 'cancel_test', width: 1, height: 1, pixelsPerBlock: 16 })
    const { unmount } = renderHook(() => useThumbnail(p))
    unmount()
    act(() => {
      vi.runAllTimers()
    })
    expect(renderPainting).not.toHaveBeenCalled()
  })

  it('reports a failed render instead of waiting forever', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(renderPainting).mockImplementationOnce(() => {
      throw new Error('boom')
    })
    const p = painting({ id: 'failing_test', width: 1, height: 1, pixelsPerBlock: 16 })
    const { result } = renderHook(() => useThumbnail(p))
    act(() => {
      vi.runAllTimers()
    })
    expect(result.current).toBe('failed')
    expect(console.error).toHaveBeenCalled()
  })

  it('keeps at most a fixed number of thumbnails in memory', () => {
    for (let i = 0; i < THUMBNAIL_CACHE_SIZE + 5; i++) {
      const p = painting({ id: `lru_${i}`, width: 1, height: 1, pixelsPerBlock: 1 })
      const { unmount } = renderHook(() => useThumbnail(p))
      act(() => {
        vi.runAllTimers()
      })
      unmount()
    }
    expect(thumbnailCacheSize()).toBe(THUMBNAIL_CACHE_SIZE)
  })

  it('is null until the idle render runs, then returns the thumbnail', () => {
    const p = painting({ id: 'hook_test', width: 1, height: 1, pixelsPerBlock: 32 })
    const { result } = renderHook(() => useThumbnail(p))
    expect(result.current).toBeNull()
    act(() => {
      vi.runAllTimers()
    })
    expect(result.current).toMatchObject({ width: 16, height: 16 })
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
