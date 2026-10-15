import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShapeError } from '../domain/errors.ts'
import { createLibrary } from '../domain/library.ts'
import * as libraryPack from '../packs/libraryPack.ts'
import { buildLibraryPack, type PackReply, type PackRequest } from './packClient.ts'

const lib = createLibrary('Ours', 'ours')
const now = new Date('2026-10-15T12:00:00Z')
const result: libraryPack.LibraryPackResult = {
  bytes: new Uint8Array([1, 2, 3]),
  fileName: 'ours-v1.zip',
  sha1: 'abc',
  library: lib,
}

/** A Worker stand-in that answers each request with the given replies. */
function fakeWorker(replies: PackReply[], received: PackRequest[]) {
  return class {
    onmessage: ((event: { data: PackReply }) => void) | null = null
    onerror: ((event: { message: string }) => void) | null = null
    terminated = false
    postMessage(request: PackRequest) {
      received.push(request)
      queueMicrotask(() => {
        for (const data of replies) this.onmessage?.({ data })
      })
    }
    terminate() {
      this.terminated = true
    }
  }
}

describe('buildLibraryPack', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('builds in a worker, passing progress through', async () => {
    const received: PackRequest[] = []
    vi.stubGlobal(
      'Worker',
      fakeWorker(
        [
          { kind: 'progress', done: 1, total: 2 },
          { kind: 'progress', done: 2, total: 2 },
          { kind: 'packed', result },
        ],
        received,
      ),
    )
    const here = vi.spyOn(libraryPack, 'writeLibraryPack')
    const progress: number[][] = []
    const out = await buildLibraryPack(lib, ['a'], {}, now, (d, t) => progress.push([d, t]))
    expect(out).toBe(result)
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ])
    expect(received).toEqual([
      { library: lib, selectedIds: ['a'], assets: {}, now: now.toISOString(), again: false },
    ])
    expect(here).not.toHaveBeenCalled()
  })

  it('keeps the error code of a failed build', async () => {
    vi.stubGlobal(
      'Worker',
      fakeWorker([{ kind: 'failed', code: 'export-failed', message: 'damaged' }], []),
    )
    const error: unknown = await buildLibraryPack(lib, [], {}, now, () => {}).catch((e) => e)
    expect(error).toBeInstanceOf(ShapeError)
    expect(error).toMatchObject({ code: 'export-failed', message: 'damaged' })
  })

  it('stops the worker when the build is aborted', async () => {
    const workers: Array<{ terminated: boolean }> = []
    const Silent = fakeWorker([], [])
    vi.stubGlobal(
      'Worker',
      class extends Silent {
        constructor() {
          super()
          workers.push(this)
        }
      },
    )
    const abort = new AbortController()
    const build = buildLibraryPack(lib, [], {}, now, () => {}, abort.signal)
    abort.abort()
    await expect(build).rejects.toMatchObject({ name: 'AbortError' })
    expect(workers[0]?.terminated).toBe(true)
  })

  it('builds on the page when there are no workers', async () => {
    vi.stubGlobal('Worker', undefined)
    const here = vi.spyOn(libraryPack, 'writeLibraryPack').mockResolvedValue(result)
    const onProgress = vi.fn()
    expect(await buildLibraryPack(lib, ['a'], {}, now, onProgress)).toBe(result)
    expect(here).toHaveBeenCalledWith(lib, ['a'], {}, now, onProgress, { again: false })
  })
})
