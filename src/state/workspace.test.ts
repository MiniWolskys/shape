import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShapeError } from '../domain/errors.ts'
import {
  createLibrary,
  createPainting,
  publish,
  updatePainting,
  upsertPainting,
} from '../domain/library.ts'
import { readLibraryPack, writeLibraryPack } from '../packs/libraryPack.ts'
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
    expect(s.getState().library).toBeNull()
    expect(s.getState().loose).toEqual([])
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
    expect(s.getState().importPack(bytes)).toEqual({
      kind: 'opened',
      added: 1,
      kept: 0,
      sourceName: 'Pack',
      sourceNamespace: 'ours',
    })
    expect(s.getState().library?.paintings.map((p) => p.id)).toEqual(ids)
    expect(Object.keys(s.getState().assets)).toContain('img0')
  })

  it('merges a same-namespace pack and adds only new assets', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    s.getState().createLibrary('Ours', 'ours')
    const { bytes, ids } = await packFor('ours', ['Sunset'])
    const merged = { kind: 'merged', sourceName: 'Pack', sourceNamespace: 'ours' }
    expect(s.getState().importPack(bytes)).toEqual({ ...merged, added: 1, kept: 0 })
    expect(s.getState().importPack(bytes)).toEqual({ ...merged, added: 0, kept: 1 })
    expect(s.getState().library?.paintings.map((p) => p.id)).toEqual(ids)
  })

  it('keeps the asset bytes of a kept local painting', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    s.getState().createLibrary('Ours', 'ours')
    const { bytes, ids } = await packFor('ours', ['Sunset'])
    s.getState().importPack(bytes)
    const local = s.getState().findPainting(ids[0] as string)!
    const source = { imageId: 'keepimg', width: 1, height: 1 }
    s.getState().setAsset('keepimg', new Uint8Array([7]))
    s.getState().savePainting({ ...local, recipe: { ...local.recipe, source } })
    s.getState().setAsset('img0', new Uint8Array([8]))
    expect(s.getState().importPack(bytes)).toMatchObject({ kind: 'merged', added: 0, kept: 1 })
    expect(Array.from(s.getState().assets.keepimg ?? [])).toEqual([7])
    expect(Array.from(s.getState().assets.img0 ?? [])).toEqual([8])
  })

  it('prunes assets of a local draft replaced by a published incoming copy', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    s.getState().createLibrary('Ours', 'ours')
    const { bytes, ids } = await packFor('ours', ['Sunset'])
    const draft = createPainting({ title: 'Sunset' }, now, () => 0.3)
    s.getState().savePainting({
      ...draft,
      id: ids[0] as string,
      recipe: { ...draft.recipe, source: { imageId: 'localimg', width: 1, height: 1 } },
    })
    s.getState().setAsset('localimg', new Uint8Array([3]))
    s.getState().importPack(bytes)
    expect(s.getState().assets.localimg).toBeUndefined()
    expect(s.getState().assets.img0).toBeDefined()
  })

  it('createLibrary prunes the assets of the library it drops', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    s.getState().createLibrary('Ours', 'ours')
    const id = s.getState().createPainting()
    const asset = s.getState().putAsset(new Uint8Array([1]))
    const p = s.getState().findPainting(id)!
    s.getState().savePainting({
      ...p,
      recipe: { ...p.recipe, source: { imageId: asset, width: 1, height: 1 } },
    })
    s.getState().createLibrary('Other', 'other')
    expect(s.getState().assets[asset]).toBeUndefined()
  })

  it('serializes saves: never overlapping, latest state saved last', async () => {
    const starts: number[] = []
    const gates: Array<() => void> = []
    let active = 0
    let maxActive = 0
    const storage: WorkspaceStorage = {
      ...memoryStorage(),
      save: (w) => {
        starts.push(w.loose.length)
        active++
        maxActive = Math.max(maxActive, active)
        return new Promise<void>((resolve) => {
          gates.push(() => {
            active--
            resolve()
          })
        })
      },
    }
    const s = createWorkspaceStore(storage)
    await s.getState().init()
    s.getState().createPainting()
    await vi.advanceTimersByTimeAsync(600)
    expect(starts).toEqual([1])
    s.getState().createPainting()
    await vi.advanceTimersByTimeAsync(600)
    s.getState().createPainting()
    await vi.advanceTimersByTimeAsync(600)
    expect(starts).toEqual([1])
    gates[0]?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(starts).toEqual([1, 3])
    gates[1]?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(starts).toEqual([1, 3])
    expect(maxActive).toBe(1)
  })

  it('concurrent init calls share one load and keep later changes', async () => {
    const storage = memoryStorage()
    const load = vi.spyOn(storage, 'load')
    const s = createWorkspaceStore(storage)
    const first = s.getState().init()
    const second = s.getState().init()
    await Promise.all([first, second])
    expect(load).toHaveBeenCalledTimes(1)
    const id = s.getState().createPainting()
    await s.getState().init()
    expect(s.getState().findPainting(id)).toBeDefined()
  })

  it('flushes a pending autosave when the page is hidden', async () => {
    const save = vi.fn(() => Promise.resolve())
    const s = createWorkspaceStore({ ...memoryStorage(), save }, { flushOnHide: true })
    await s.getState().init()
    s.getState().createPainting()
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('throws on bytes that are not a pack without changing state', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    expect(() => s.getState().importPack(new Uint8Array([1, 2, 3]))).toThrow(ShapeError)
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
    expect(b.getState().loose.map((p) => p.id)).toEqual([id])
    expect(Array.from(b.getState().assets[assetId] ?? [])).toEqual([9, 9])
  })

  it('makes a draft painting with a fresh id without adding it (R18)', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    const taken = s.getState().createPainting()
    const draft = s.getState().draftPainting()
    expect(draft.id).not.toBe(taken)
    expect(draft).toMatchObject({ title: '', status: 'ready', width: 1, height: 1 })
    expect(s.getState().findPainting(draft.id)).toBeUndefined()
    expect(s.getState().loose).toHaveLength(1)
  })

  it('persistNow writes pending changes at once', async () => {
    const storage = memoryStorage()
    const a = createWorkspaceStore(storage)
    await a.getState().init()
    const id = a.getState().createPainting()
    await a.getState().persistNow()
    expect((await storage.load())?.loose.map((p) => p.id)).toEqual([id])
  })

  it('does not autosave on ready or saveError changes alone', async () => {
    const save = vi.fn(() => Promise.resolve())
    const storage: WorkspaceStorage = { ...memoryStorage(), save }
    const s = createWorkspaceStore(storage)
    await s.getState().init()
    s.setState({ saveError: 'storage-full', ready: true })
    await vi.advanceTimersByTimeAsync(2000)
    expect(s.getState().saveError).toBe('storage-full')
    expect(save).not.toHaveBeenCalled()
  })

  it('sets storage-full on quota errors and clears it after a good save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
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
    vi.mocked(console.error).mockRestore()
  })

  it('surfaces every other save failure, retries on the next change and clears on success (C1)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let fail = true
    const save = vi.fn(() =>
      fail
        ? Promise.reject(new DOMException('Connection lost', 'UnknownError'))
        : Promise.resolve(),
    )
    const s = createWorkspaceStore({ ...memoryStorage(), save })
    await s.getState().init()
    s.getState().createPainting()
    await vi.advanceTimersByTimeAsync(600)
    expect(s.getState().saveError).toBe('storage-failed')
    expect(log).toHaveBeenCalled()
    s.getState().createPainting()
    await vi.advanceTimersByTimeAsync(600)
    expect(save).toHaveBeenCalledTimes(2)
    expect(s.getState().saveError).toBe('storage-failed')
    fail = false
    s.getState().createPainting()
    await vi.advanceTimersByTimeAsync(600)
    expect(s.getState().saveError).toBeNull()
    log.mockRestore()
  })

  it('suspend stops every save at once, pending ones included (R38)', async () => {
    const save = vi.fn(() => Promise.resolve())
    const s = createWorkspaceStore({ ...memoryStorage(), save })
    await s.getState().init()
    s.getState().createPainting()
    s.getState().suspend()
    s.getState().createPainting()
    await vi.advanceTimersByTimeAsync(2000)
    await s.getState().persistNow()
    expect(save).not.toHaveBeenCalled()
  })

  it('asks the browser once to keep its storage, after the first good save (I5)', async () => {
    const persist = vi.fn(() => Promise.resolve(true))
    vi.stubGlobal('navigator', { ...navigator, storage: { persist } })
    const s = createWorkspaceStore(memoryStorage(), { persistStorage: true })
    await s.getState().init()
    expect(persist).not.toHaveBeenCalled()
    s.getState().createPainting()
    await vi.advanceTimersByTimeAsync(600)
    s.getState().createPainting()
    await vi.advanceTimersByTimeAsync(600)
    expect(persist).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('counts the stored assets that were missing at load (I1)', async () => {
    const storage = memoryStorage()
    const s = createWorkspaceStore({
      ...storage,
      load: async () => ({ library: null, loose: [], assets: {}, missingAssets: 2 }),
    })
    await s.getState().init()
    expect(s.getState().missingAssets).toBe(2)
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
    const copyId = s.getState().duplicatePainting(a, '(copy)')
    const copy = s.getState().findPainting(copyId)!
    expect(copyId).not.toBe(a)
    expect(copy.status).toBe('ready')
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
  it('pruneUnreferencedAssets drops assets no painting uses, except the kept ones', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    const a = s.getState().createPainting()
    s.getState().createLibrary('Ours', 'ours')
    const b = s.getState().createPainting()
    const looseImage = s.getState().putAsset(new Uint8Array([1]))
    const libImage = s.getState().putAsset(new Uint8Array([2]))
    s.getState().setAsset('edits1', new Uint8Array([3]))
    s.getState().setAsset('edits1.mask', new Uint8Array([4]))
    const orphan = s.getState().putAsset(new Uint8Array([5]))
    const kept = s.getState().putAsset(new Uint8Array([6]))
    const pa = s.getState().findPainting(a)!
    const pb = s.getState().findPainting(b)!
    s.getState().savePainting({
      ...pa,
      recipe: { ...pa.recipe, source: { imageId: looseImage, width: 1, height: 1 } },
    })
    s.getState().savePainting({
      ...pb,
      recipe: {
        ...pb.recipe,
        source: { imageId: libImage, width: 1, height: 1 },
        editsId: 'edits1',
      },
    })
    s.getState().pruneUnreferencedAssets([kept])
    expect(Object.keys(s.getState().assets).sort()).toEqual(
      [looseImage, libImage, 'edits1', 'edits1.mask', kept].sort(),
    )
    expect(s.getState().assets[orphan]).toBeUndefined()
    s.getState().pruneUnreferencedAssets()
    expect(s.getState().assets[kept]).toBeUndefined()
  })

  it('pruneUnreferencedAssets leaves the assets object alone when nothing is unused', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    const before = s.getState().assets
    s.getState().pruneUnreferencedAssets()
    expect(s.getState().assets).toBe(before)
  })

  it('starts new paintings as ready (R16)', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    const id = s.getState().createPainting()
    expect(s.getState().findPainting(id)?.status).toBe('ready')
  })
})

describe('library data safety (R15)', () => {
  it('applyExport records the export time unless the library already has one', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-20T08:00:00Z') })
    try {
      const s = createWorkspaceStore(memoryStorage())
      await s.getState().init()
      s.getState().createLibrary('Ours', 'ours')
      const id = s.getState().createPainting()
      const lib = s.getState().library!
      s.getState().applyExport(publish(lib, [id], now))
      expect(s.getState().library?.exportedAt).toBe('2026-10-20T08:00:00.000Z')
      s.getState().applyExport({ ...publish(lib, [id], now), exportedAt: now.toISOString() })
      expect(s.getState().library?.exportedAt).toBe(now.toISOString())
    } finally {
      vi.useRealTimers()
    }
  })

  it('applyExport merges what the export changed into the library as it is now', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    s.getState().createLibrary('Ours', 'ours')
    const a = s.getState().createPainting()
    const b = s.getState().createPainting()
    const exported = { ...publish(s.getState().library!, [a], now), exportedAt: now.toISOString() }
    // Meanwhile: a new painting, a retitled one and an edit after the export started.
    const c = s.getState().createPainting()
    const bNow = s.getState().retitlePainting(b, 'Renamed')
    const later = '2099-01-01T00:00:00.000Z'
    s.getState().savePainting({ ...s.getState().findPainting(a)!, updatedAt: later })
    s.getState().applyExport(exported)
    const lib = s.getState().library!
    expect(lib.version).toBe(exported.version)
    expect(lib.exportedAt).toBe(now.toISOString())
    expect(lib.paintings.map((p) => p.id)).toEqual([a, bNow, c])
    expect(s.getState().findPainting(bNow)?.title).toBe('Renamed')
    const pa = s.getState().findPainting(a)
    expect(pa).toMatchObject({ status: 'published', publishedIn: exported.version })
    // Edited after the export began: still counts as changed since that export.
    expect(pa?.updatedAt).toBe(later)
  })

  it('applyExport ignores an export of a library that is no longer open', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    s.getState().createLibrary('Ours', 'ours')
    const a = s.getState().createPainting()
    const exported = publish(s.getState().library!, [a], now)
    s.getState().createLibrary('Other', 'other')
    s.getState().applyExport(exported)
    expect(s.getState().library).toMatchObject({ namespace: 'other', version: 0 })
    s.getState().closeLibrary()
    s.getState().applyExport(exported)
    expect(s.getState().library).toBeNull()
  })

  it('counts the open library paintings that closing would lose', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    expect(s.getState().unexportedCount()).toBe(0)
    s.getState().createPainting()
    s.getState().createLibrary('Ours', 'ours')
    expect(s.getState().unexportedCount()).toBe(0)
    const a = s.getState().createPainting()
    s.getState().createPainting()
    expect(s.getState().unexportedCount()).toBe(2)
    const lib = s.getState().library!
    s.getState().applyExport({ ...publish(lib, [a], now), exportedAt: '2999-01-01T00:00:00.000Z' })
    expect(s.getState().unexportedCount()).toBe(1)
  })

  it('a pack written by writeLibraryPack opens with nothing unexported', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    const { bytes } = await packFor('ours', ['Sunset', 'Moon'])
    s.getState().importPack(bytes)
    expect(s.getState().library?.exportedAt).toBe(now.toISOString())
    expect(s.getState().unexportedCount()).toBe(0)
  })
})

describe('retitlePainting (R17)', () => {
  async function storeWith() {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    return s
  }

  it('renames an unpublished painting and moves its id, keeping its assets', async () => {
    const s = await storeWith()
    s.getState().createLibrary('Ours', 'ours')
    const id = s.getState().createPainting()
    const img = s.getState().putAsset(new Uint8Array([5]))
    const p = s.getState().findPainting(id)!
    s.getState().savePainting({
      ...p,
      recipe: { ...p.recipe, source: { imageId: img, width: 1, height: 1 } },
    })
    const suffix = id.split('_').at(-1)
    const next = s.getState().retitlePainting(id, 'Rosace du soir')
    expect(next).toBe(`rosace_du_soir_${suffix}`)
    expect(s.getState().findPainting(id)).toBeUndefined()
    const moved = s.getState().findPainting(next)!
    expect(moved.title).toBe('Rosace du soir')
    expect(moved.recipe.source?.imageId).toBe(img)
    expect(s.getState().library?.paintings).toHaveLength(1)
    expect(s.getState().assets[img]).toBeDefined()
  })

  it('renames loose paintings in place and avoids ids used by the library', async () => {
    const s = await storeWith()
    const loose = s.getState().createPainting()
    s.getState().createPainting()
    s.getState().createLibrary('Ours', 'ours')
    const inLib = s.getState().createPainting()
    const libId = s.getState().retitlePainting(inLib, 'Rose')
    const suffix = libId.split('_').at(-1) ?? ''
    // Put the loose painting on the same suffix so its natural new id collides.
    s.setState((st) => ({
      loose: st.loose.map((q) => (q.id === loose ? { ...q, id: `painting_${suffix}` } : q)),
    }))
    const next = s.getState().retitlePainting(`painting_${suffix}`, 'Rose')
    expect(next).not.toBe(libId)
    expect(next).toMatch(/^rose_[a-z0-9]{3}$/)
    expect(s.getState().loose[0]?.id).toBe(next)
    expect(s.getState().loose).toHaveLength(2)
  })

  it('keeps a published painting id', async () => {
    const s = await storeWith()
    s.getState().createLibrary('Ours', 'ours')
    const id = s.getState().createPainting()
    s.getState().applyExport(publish(s.getState().library!, [id], now))
    expect(s.getState().retitlePainting(id, 'Renamed')).toBe(id)
    expect(s.getState().findPainting(id)?.title).toBe('Renamed')
  })

  it('changes nothing when the title is the same', async () => {
    const s = await storeWith()
    const id = s.getState().createPainting()
    const before = s.getState().loose
    expect(s.getState().retitlePainting(id, '')).toBe(id)
    expect(s.getState().loose).toBe(before)
  })

  it('throws for an unknown painting', async () => {
    const s = await storeWith()
    expect(() => s.getState().retitlePainting('nope_abc', 'X')).toThrow()
  })
})

describe('duplicatePainting', () => {
  it('titles the copy with the suffix and inserts it right after the original', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    s.getState().createLibrary('Ours', 'ours')
    const a = s.getState().createPainting()
    s.getState().createPainting()
    const pa = s.getState().findPainting(a)!
    s.getState().savePainting({ ...pa, title: 'Rosace du soir' })
    const copy = s.getState().duplicatePainting(a, '(copie)')
    const paintings = s.getState().library!.paintings
    expect(paintings.map((p) => p.id).indexOf(copy)).toBe(1)
    expect(paintings[1]).toMatchObject({ title: 'Rosace du soir (copie)', status: 'ready' })
    expect(copy).toMatch(/^rosace_du_soir_copie_[a-z0-9]{3}$/)
  })

  it('inserts a loose copy after its original too', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    const a = s.getState().createPainting()
    s.getState().createPainting()
    const copy = s.getState().duplicatePainting(a, '(copy)')
    expect(
      s
        .getState()
        .loose.map((p) => p.id)
        .indexOf(copy),
    ).toBe(1)
    expect(s.getState().findPainting(copy)?.title).toBe('(copy)')
  })

  it('drops publishedIn from a copy of a published painting', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    s.getState().createLibrary('Ours', 'ours')
    const a = s.getState().createPainting()
    s.getState().applyExport(publish(s.getState().library!, [a], now))
    const copy = s.getState().findPainting(s.getState().duplicatePainting(a, '(copy)'))!
    expect(copy.status).toBe('ready')
    expect(copy.publishedIn).toBeUndefined()
  })
})

describe('importPack (R21)', () => {
  it('copies the paintings of another library into the open one as new unpublished ones', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    s.getState().createLibrary('Ours', 'ours')
    const mine = s.getState().createPainting()
    s.getState().setAsset('img0', new Uint8Array([42]))
    const { bytes, ids } = await packFor('theirs', ['Sunset', 'Moon'])
    expect(s.getState().importPack(bytes)).toEqual({
      kind: 'copied',
      added: 2,
      kept: 0,
      sourceName: 'Pack',
      sourceNamespace: 'theirs',
    })
    const { library, assets } = s.getState()
    expect(library).toMatchObject({ name: 'Ours', namespace: 'ours', version: 0 })
    expect(library?.exportedAt).toBeUndefined()
    const [first, sunset, moon] = library!.paintings
    expect(first?.id).toBe(mine)
    expect([sunset?.title, moon?.title]).toEqual(['Sunset', 'Moon'])
    for (const p of [sunset!, moon!]) {
      expect(ids).not.toContain(p.id)
      expect(p.status).toBe('ready')
      expect(p.publishedIn).toBeUndefined()
      const imageId = p.recipe.source?.imageId ?? ''
      expect(imageId).not.toMatch(/^img\d$/)
      expect(assets[imageId]?.length).toBeGreaterThan(1)
    }
    expect(sunset!.id).toMatch(/^sunset_[a-z0-9]{3}$/)
    expect(Array.from(assets.img0 ?? [])).toEqual([42])
    expect(s.getState().unexportedCount()).toBe(3)
  })

  it('leaves the state unchanged when the bytes are not a pack', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    s.getState().createLibrary('Ours', 'ours')
    const before = s.getState()
    expect(() => s.getState().importPack(new Uint8Array([1, 2, 3]))).toThrow(ShapeError)
    expect(s.getState().library).toBe(before.library)
    expect(s.getState().assets).toBe(before.assets)
  })

  it('opening a pack with no library open clears the demo flag', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    s.setState({ demo: true })
    const { bytes } = await packFor('ours', ['Sunset'])
    s.getState().importPack(bytes)
    expect(s.getState().demo).toBe(false)
  })
})

describe('loose paintings (I16)', () => {
  it('adds only the chosen loose paintings to the library', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    const a = s.getState().createPainting()
    const b = s.getState().createPainting()
    s.getState().createLibrary('Ours', 'ours')
    expect(s.getState().addLooseToLibrary([b])).toBe(1)
    expect(s.getState().library?.paintings.map((p) => p.id)).toEqual([b])
    expect(s.getState().loose.map((p) => p.id)).toEqual([a])
    expect(s.getState().addLooseToLibrary()).toBe(1)
    expect(s.getState().loose).toEqual([])
  })
})

describe('demo flag (R23)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts false, clears on create and close, and survives a reload', async () => {
    const storage = memoryStorage()
    const s = createWorkspaceStore(storage)
    await s.getState().init()
    expect(s.getState().demo).toBe(false)
    s.setState({ demo: true })
    await vi.advanceTimersByTimeAsync(600)
    const again = createWorkspaceStore(storage)
    await again.getState().init()
    expect(again.getState().demo).toBe(true)
    s.getState().createLibrary('Ours', 'ours')
    expect(s.getState().demo).toBe(false)
    s.setState({ demo: true })
    s.getState().closeLibrary()
    expect(s.getState().demo).toBe(false)
  })

  async function demoStore(storage = memoryStorage()) {
    const s = createWorkspaceStore(storage)
    await s.getState().init()
    s.getState().createLibrary('Sample', 'sample')
    const a = s.getState().createPainting()
    const b = s.getState().createPainting()
    s.setState({ demo: true, demoIds: [a, b] })
    return { s, a, b }
  }

  it('does not count untouched sample paintings, but counts edited ones', async () => {
    const { s, a } = await demoStore()
    expect(s.getState().unexportedCount()).toBe(0)
    const p = s.getState().findPainting(a)!
    s.getState().savePainting(updatePainting(p, { title: 'Mine' }, new Date(Date.now() + 1000)))
    expect(s.getState().unexportedCount()).toBe(1)
  })

  it('counts paintings made in the demo, including duplicates and imported copies', async () => {
    const { s, a } = await demoStore()
    s.getState().duplicatePainting(a, '(copy)')
    expect(s.getState().unexportedCount()).toBe(1)
  })

  it('puts paintings made while the demo is open outside it, as loose paintings', async () => {
    const { s } = await demoStore()
    const made = s.getState().createPainting()
    const draft = s.getState().draftPainting()
    s.getState().savePainting(draft)
    expect(s.getState().library?.paintings.map((p) => p.id)).not.toContain(made)
    expect(s.getState().loose.map((p) => p.id)).toEqual([made, draft.id])
    expect(s.getState().unexportedCount()).toBe(0)
  })

  async function demoWithMyWork() {
    const { s, a, b } = await demoStore()
    const p = s.getState().findPainting(a)!
    const imageId = s.getState().putAsset(new Uint8Array([1]))
    const editsId = s.getState().putAsset(new Uint8Array([2]))
    s.getState().setAsset(`${editsId}.mask`, new Uint8Array([3]))
    const mine = updatePainting(
      p,
      { recipe: { ...p.recipe, source: { imageId, width: 1, height: 1 }, editsId } },
      new Date(Date.now() + 1000),
    )
    s.getState().savePainting(mine)
    return { s, a, b, kept: [imageId, editsId, `${editsId}.mask`] }
  }

  it('keeps the assets of demo paintings kept outside when the demo closes', async () => {
    const { s, kept } = await demoWithMyWork()
    expect(s.getState().keepDemoWork()).toBe(1)
    s.getState().closeLibrary()
    for (const id of kept) expect(s.getState().assets[id]).toBeDefined()
  })

  it('keeps the assets of demo paintings kept outside when a pack replaces the demo', async () => {
    const { s, kept } = await demoWithMyWork()
    s.getState().keepDemoWork()
    const { bytes } = await packFor('theirs', ['Sunset'])
    s.getState().importPack(bytes)
    expect(s.getState().library?.namespace).toBe('theirs')
    for (const id of kept) expect(s.getState().assets[id]).toBeDefined()
  })

  it('keeps the demo paintings the player made or changed, as loose ones', async () => {
    const { s, a, b } = await demoStore()
    const p = s.getState().findPainting(a)!
    s.getState().savePainting(updatePainting(p, { title: 'Mine' }, new Date(Date.now() + 1000)))
    const copy = s.getState().duplicatePainting(b, '(copy)')
    expect(s.getState().keepDemoWork()).toBe(2)
    expect(s.getState().loose.map((q) => q.id)).toEqual([a, copy])
    expect(s.getState().library?.paintings.map((q) => q.id)).toEqual([b])
    s.getState().closeLibrary()
    expect(s.getState().loose).toHaveLength(2)
  })

  it('keeps the sample ids across a reload and clears them with the demo', async () => {
    const storage = memoryStorage()
    const { s, a, b } = await demoStore(storage)
    await vi.advanceTimersByTimeAsync(600)
    const again = createWorkspaceStore(storage)
    await again.getState().init()
    expect(again.getState().demoIds).toEqual([a, b])
    expect(again.getState().unexportedCount()).toBe(0)
    s.getState().closeLibrary()
    expect(s.getState().demoIds).toEqual([])
  })

  it('opens an imported pack in place of the demo instead of copying into it (R25)', async () => {
    const { s } = await demoStore()
    const { bytes, ids } = await packFor('theirs', ['Sunset'])
    expect(s.getState().importPack(bytes)).toMatchObject({ kind: 'opened', added: 1, kept: 0 })
    expect(s.getState().library?.namespace).toBe('theirs')
    expect(s.getState().library?.paintings.map((p) => p.id)).toEqual(ids)
    expect(s.getState().demo).toBe(false)
    expect(s.getState().demoIds).toEqual([])
  })
})

describe('opening packs', () => {
  it('never adopts an export time from the future (clock skew)', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    const { bytes } = await packFor('ours', ['Sunset'])
    const pack = readLibraryPack(bytes)
    const ahead = { ...pack, library: { ...pack.library, exportedAt: '2999-01-01T00:00:00.000Z' } }
    s.getState().importPack(ahead)
    expect(Date.parse(s.getState().library?.exportedAt ?? '')).toBeLessThanOrEqual(Date.now())
  })
})

describe('assets shared between packs (C2)', () => {
  const bytes = (n: number) => encodePng(createRaster(2, 2, [n, n, n, 255]))

  async function ownerWithDraft() {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    s.getState().createLibrary('Ours', 'ours')
    const p0 = createPainting({ width: 1, height: 1, pixelsPerBlock: 2 }, now, () => 0.5)
    const draft = {
      ...p0,
      id: 'painting_k3x',
      recipe: {
        ...p0.recipe,
        source: { imageId: 'srcimg', width: 2, height: 2 },
        editsId: 'edits1',
      },
    }
    s.getState().setAsset('srcimg', bytes(10))
    s.getState().setAsset('edits1', bytes(20))
    s.getState().setAsset('edits1.mask', bytes(255))
    s.getState().savePainting(draft)
    const { library, assets } = s.getState()
    const v1 = await writeLibraryPack(library!, [], assets, now)
    return { s, v1 }
  }

  it('a merge never overwrites the edits of a draft renamed since the shared pack', async () => {
    const { s, v1 } = await ownerWithDraft()
    // The owner titles the draft (its id follows) and keeps painting over the same asset id.
    const rose = s.getState().retitlePainting('painting_k3x', 'Rose')
    s.getState().setAsset('edits1', bytes(30))
    // As a library from before former ids were recorded (I4), so the old id comes back as new.
    const renamed = s.getState().findPainting(rose)!
    s.getState().savePainting({ ...renamed, formerIds: [] })
    // A friend's pack derived from v1 comes back: it still holds painting_k3x with the v1 edits.
    s.getState().importPack(v1.bytes)
    const { assets } = s.getState()
    expect(assets.edits1).toEqual(bytes(30))
    expect(s.getState().findPainting(rose)?.recipe.editsId).toBe('edits1')
    const back = s.getState().findPainting('painting_k3x')
    const editsId = back?.recipe.editsId ?? ''
    expect(editsId).not.toBe('edits1')
    expect(assets[editsId]).toEqual(bytes(20))
    expect(assets[`${editsId}.mask`]).toEqual(bytes(255))
    // Identical bytes stay shared: the picture was not copied.
    expect(back?.recipe.source?.imageId).toBe('srcimg')
  })

  it('a renamed draft does not come back as a ghost from an older pack (I4)', async () => {
    const { s, v1 } = await ownerWithDraft()
    const rose = s.getState().retitlePainting('painting_k3x', 'Rose')
    expect(s.getState().importPack(v1.bytes)).toMatchObject({ added: 0, kept: 1 })
    expect(s.getState().library?.paintings.map((p) => p.id)).toEqual([rose])
  })

  it('a pack replacing the demo never overwrites the assets of loose paintings', async () => {
    const { v1 } = await ownerWithDraft()
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    const p0 = createPainting({ width: 1, height: 1, pixelsPerBlock: 2 }, now, () => 0.7)
    s.getState().setAsset('srcimg', bytes(99))
    s.getState().savePainting({
      ...p0,
      recipe: { ...p0.recipe, source: { imageId: 'srcimg', width: 2, height: 2 } },
    })
    s.setState({ library: createLibrary('Demo', 'demo'), demo: true })
    s.getState().importPack(v1.bytes)
    const { assets, loose, library } = s.getState()
    expect(loose[0]?.recipe.source?.imageId).toBe('srcimg')
    expect(assets.srcimg).toEqual(bytes(99))
    const incoming = library?.paintings[0]?.recipe.source?.imageId ?? ''
    expect(incoming).not.toBe('srcimg')
    expect(assets[incoming]).toEqual(bytes(10))
  })
})
