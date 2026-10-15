import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShapeError } from '../domain/errors.ts'
import { createLibrary, createPainting, publish, upsertPainting } from '../domain/library.ts'
import { writeLibraryPack } from '../packs/libraryPack.ts'
import { encodePng } from '../packs/png.ts'
import { createRaster } from '../imaging/raster.ts'
import { memoryStorage } from '../storage/persistence.ts'
import type { WorkspaceStorage } from '../storage/persistence.ts'
import { createWorkspaceStore } from './workspace.ts'

const now = new Date('2026-10-15T12:00:00Z')

async function packFor(namespace: string, titles: string[]) {
  let lib = createLibrary('Pack', namespace)
  const assets: Record<string, Uint8Array> = {}
  const ids: string[] = []
  titles.forEach((title, i) => {
    const p0 = createPainting({ title, width: 1, height: 1, pixelsPerBlock: 16 }, now, () => 0.3)
    const imageId = `img${i}`
    const p = {
      ...p0,
      id: `${p0.id}${i}`,
      recipe: { ...p0.recipe, source: { imageId, width: 4, height: 4 } },
    }
    assets[imageId] = encodePng(createRaster(4, 4, [0, 255, 0, 255]))
    lib = upsertPainting(lib, p)
    ids.push(p.id)
  })
  const out = await writeLibraryPack(lib, ids, assets, now)
  return { bytes: out.bytes, ids }
}

describe('workspace store', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts empty without saved work', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    expect(s.getState().ready).toBe(true)
    expect(s.getState().hasSavedWork).toBe(false)
  })

  it('puts new paintings into loose until a library is open, then moves them', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    const id = s.getState().createPainting()
    expect(s.getState().loose.map((p) => p.id)).toEqual([id])
    s.getState().createLibrary('Ours', 'ours')
    expect(s.getState().loose).toHaveLength(1)
    expect(s.getState().addLooseToLibrary()).toBe(1)
    expect(s.getState().loose).toEqual([])
    expect(s.getState().library?.paintings.map((p) => p.id)).toEqual([id])
    const second = s.getState().createPainting()
    expect(s.getState().library?.paintings.map((p) => p.id)).toContain(second)
  })

  it('rejects an invalid namespace', async () => {
    const s = createWorkspaceStore(memoryStorage())
    expect(() => s.getState().createLibrary('x', 'Bad Name')).toThrow()
  })

  it('opens a pack as the library when none is open', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    const { bytes, ids } = await packFor('ours', ['Sunset'])
    expect(s.getState().openLibraryPack(bytes)).toEqual({ added: 1, kept: 0 })
    expect(s.getState().library?.paintings.map((p) => p.id)).toEqual(ids)
    expect(Object.keys(s.getState().assets)).toContain('img0')
  })

  it('merges a same-namespace pack and adds only new assets', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    s.getState().createLibrary('Ours', 'ours')
    const { bytes, ids } = await packFor('ours', ['Sunset'])
    expect(s.getState().openLibraryPack(bytes)).toEqual({ added: 1, kept: 0 })
    expect(s.getState().openLibraryPack(bytes)).toEqual({ added: 0, kept: 1 })
    expect(s.getState().library?.paintings.map((p) => p.id)).toEqual(ids)
  })

  it('throws on a foreign namespace and leaves state unchanged', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    s.getState().createLibrary('Ours', 'ours')
    const before = s.getState()
    const { bytes } = await packFor('theirs', ['Sunset'])
    expect(() => s.getState().openLibraryPack(bytes)).toThrow(ShapeError)
    expect(s.getState().library).toBe(before.library)
    expect(s.getState().assets).toBe(before.assets)
  })

  it('throws on bytes that are not a pack without changing state', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    expect(() => s.getState().openLibraryPack(new Uint8Array([1, 2, 3]))).toThrow(ShapeError)
    expect(s.getState().library).toBeNull()
  })

  it('autosaves after 600 ms and a second store restores the work', async () => {
    const storage = memoryStorage()
    const a = createWorkspaceStore(storage)
    await a.getState().init()
    const id = a.getState().createPainting()
    const assetId = a.getState().putAsset(new Uint8Array([9, 9]))
    await vi.advanceTimersByTimeAsync(599)
    expect(await storage.load()).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    const b = createWorkspaceStore(storage)
    await b.getState().init()
    expect(b.getState().hasSavedWork).toBe(true)
    expect(b.getState().loose.map((p) => p.id)).toEqual([id])
    expect(Array.from(b.getState().assets[assetId] ?? [])).toEqual([9, 9])
  })

  it('does not autosave on ready or saveError changes alone', async () => {
    const save = vi.fn(() => Promise.resolve())
    const storage: WorkspaceStorage = { ...memoryStorage(), save }
    const s = createWorkspaceStore(storage)
    await s.getState().init()
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).not.toHaveBeenCalled()
  })

  it('sets storage-full on quota errors and clears it after a good save', async () => {
    let fail = true
    const storage: WorkspaceStorage = {
      ...memoryStorage(),
      save: () => {
        if (!fail) return Promise.resolve()
        const e = new Error('quota')
        e.name = 'QuotaExceededError'
        return Promise.reject(e)
      },
    }
    const s = createWorkspaceStore(storage)
    await s.getState().init()
    s.getState().createPainting()
    await vi.advanceTimersByTimeAsync(600)
    expect(s.getState().saveError).toBe('storage-full')
    fail = false
    s.getState().createPainting()
    await vi.advanceTimersByTimeAsync(600)
    expect(s.getState().saveError).toBeNull()
  })

  it('keeps saveError null and logs other save failures', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const storage: WorkspaceStorage = {
      ...memoryStorage(),
      save: () => Promise.reject(new Error('boom')),
    }
    const s = createWorkspaceStore(storage)
    await s.getState().init()
    s.getState().createPainting()
    await vi.advanceTimersByTimeAsync(600)
    expect(s.getState().saveError).toBeNull()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('refuses to delete a published painting', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    s.getState().createLibrary('Ours', 'ours')
    const id = s.getState().createPainting()
    const lib = s.getState().library
    if (!lib) throw new Error('no library')
    s.getState().applyExport(publish(lib, [id], now))
    expect(() => s.getState().deletePainting(id)).toThrow(ShapeError)
    expect(s.getState().findPainting(id)).toBeDefined()
  })

  it('deletes a painting and its unshared assets only', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    const a = s.getState().createPainting()
    const b = s.getState().createPainting()
    const shared = s.getState().putAsset(new Uint8Array([1]))
    const own = s.getState().putAsset(new Uint8Array([2]))
    const pa = s.getState().findPainting(a)!
    const pb = s.getState().findPainting(b)!
    const source = { imageId: shared, width: 1, height: 1 }
    s.getState().savePainting({ ...pa, recipe: { ...pa.recipe, source, editsId: own } })
    s.getState().savePainting({ ...pb, recipe: { ...pb.recipe, source } })
    s.getState().deletePainting(a)
    expect(s.getState().findPainting(a)).toBeUndefined()
    expect(s.getState().assets[shared]).toBeDefined()
    expect(s.getState().assets[own]).toBeUndefined()
    s.getState().deletePainting(b)
    expect(s.getState().assets[shared]).toBeUndefined()
  })

  it('duplicates a painting with its own copies of the assets', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    const a = s.getState().createPainting()
    const img = s.getState().putAsset(new Uint8Array([5]))
    const pa = s.getState().findPainting(a)!
    s.getState().savePainting({
      ...pa,
      recipe: { ...pa.recipe, source: { imageId: img, width: 1, height: 1 } },
    })
    const copyId = s.getState().duplicatePainting(a)
    const copy = s.getState().findPainting(copyId)!
    expect(copyId).not.toBe(a)
    expect(copy.status).toBe('draft')
    expect(copy.recipe.source?.imageId).not.toBe(img)
    expect(Array.from(s.getState().assets[copy.recipe.source!.imageId] ?? [])).toEqual([5])
  })

  it('closeLibrary keeps loose paintings and their assets', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    const loose = s.getState().createPainting()
    s.getState().createLibrary('Ours', 'ours')
    s.getState().createPainting()
    s.getState().closeLibrary()
    expect(s.getState().library).toBeNull()
    expect(s.getState().findPainting(loose)).toBeDefined()
  })
})
