import 'fake-indexeddb/auto'
import { clear as idbClear, del, get, keys, set } from 'idb-keyval'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLibrary, createPainting, upsertPainting } from '../domain/library.ts'
import type { Workspace } from '../domain/types.ts'
import { createIdbStorage } from './persistence.ts'

const now = new Date('2026-10-15T12:00:00Z')

function workspace(assets: Workspace['assets'] = {}): Workspace {
  const p = createPainting({ title: 'Sunset' }, now, () => 0.3)
  return {
    library: upsertPainting(createLibrary('Ours', 'ours'), p),
    loose: [createPainting({ title: 'Loose' }, now, () => 0.6)],
    assets,
  }
}

describe('idbStorage', () => {
  beforeEach(async () => {
    await idbClear()
  })

  it('round-trips library, loose paintings and asset bytes', async () => {
    const storage = createIdbStorage()
    const w = workspace({ a: new Uint8Array([1, 2, 3]), b: new Uint8Array([4]) })
    await storage.save(w)
    const loaded = await createIdbStorage().load()
    expect(loaded?.library).toEqual(w.library)
    expect(loaded?.loose).toEqual(w.loose)
    expect(Array.from(loaded?.assets.a ?? [])).toEqual([1, 2, 3])
    expect(Array.from(loaded?.assets.b ?? [])).toEqual([4])
  })

  it('keeps the demo flag, and reads records saved without it as not a demo', async () => {
    await createIdbStorage().save({ ...workspace(), demo: true })
    expect((await createIdbStorage().load())?.demo).toBe(true)
    const record = await get<Record<string, unknown>>('shape:workspace:v1')
    await set('shape:workspace:v1', { ...record, demo: undefined })
    expect((await createIdbStorage().load())?.demo).toBe(false)
  })

  it('returns null when nothing is stored', async () => {
    expect(await createIdbStorage().load()).toBeNull()
  })

  it('deletes the key of an asset removed from state on the next save', async () => {
    const storage = createIdbStorage()
    await storage.save(workspace({ a: new Uint8Array([1]), b: new Uint8Array([2]) }))
    await storage.save(workspace({ a: new Uint8Array([1]) }))
    expect(await get('shape:assets:b')).toBeUndefined()
    expect(await get('shape:assets:a')).toBeDefined()
  })

  it('rewrites an asset whose bytes were replaced under the same id', async () => {
    const storage = createIdbStorage()
    await storage.save(workspace({ a: new Uint8Array([1]) }))
    await storage.save(workspace({ a: new Uint8Array([9]) }))
    const loaded = await storage.load()
    expect(Array.from(loaded?.assets.a ?? [])).toEqual([9])
  })

  it('does not share its write cache with another storage instance', async () => {
    const bytes = new Uint8Array([5])
    await createIdbStorage().save(workspace({ a: bytes }))
    await idbClear()
    await createIdbStorage().save(workspace({ a: bytes }))
    const loaded = await createIdbStorage().load()
    expect(Array.from(loaded?.assets.a ?? [])).toEqual([5])
  })

  it('clear removes every key', async () => {
    const storage = createIdbStorage()
    await storage.save(workspace({ a: new Uint8Array([1]), b: new Uint8Array([2]) }))
    await storage.clear()
    expect(await keys()).toEqual([])
    expect(await storage.load()).toBeNull()
  })

  it('rethrows a failing idb write', async () => {
    const storage = createIdbStorage()
    const w = workspace()
    const bad = {
      ...w,
      loose: [{ ...(w.loose[0] as object), fn: () => 1 }],
    } as unknown as Workspace
    await expect(storage.save(bad)).rejects.toThrow()
  })

  it('warns when a listed asset is missing on load', async () => {
    const storage = createIdbStorage()
    await storage.save(workspace({ a: new Uint8Array([1]) }))
    await del('shape:assets:a')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const loaded = await storage.load()
    expect(warn).toHaveBeenCalled()
    expect(loaded?.assets.a).toBeUndefined()
    warn.mockRestore()
    await set('unused', 1)
  })
})
