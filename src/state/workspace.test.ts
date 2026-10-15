import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShapeError } from '../domain/errors.ts'
import {
  createLibrary,
  createPainting,
  publish,
  updatePainting,
  upsertPainting,
} from '../domain/library.ts'
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

  it('does not count untouched paintings of the demo as unexported', async () => {
    const s = createWorkspaceStore(memoryStorage())
    await s.getState().init()
    s.getState().createLibrary('Sample', 'sample')
    const a = s.getState().createPainting()
    s.getState().createPainting()
    s.setState({ demo: true })
    expect(s.getState().unexportedCount()).toBe(0)
    const p = s.getState().findPainting(a)!
    s.getState().savePainting(updatePainting(p, { title: 'Mine' }, new Date(Date.now() + 1000)))
    expect(s.getState().unexportedCount()).toBe(1)
  })
})
