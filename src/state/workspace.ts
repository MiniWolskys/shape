import { create } from 'zustand'
import type { ShapeErrorCode } from '../domain/errors.ts'
import { isValidNamespace, makeAssetId, makePaintingId } from '../domain/ids.ts'
import {
  addLoosePaintings,
  copyAsNew,
  createLibrary as newLibrary,
  createPainting as newPainting,
  insertAfter,
  mergeLibraries,
  removePainting,
  retitlePainting,
  unexportedPaintings,
  upsertPainting,
} from '../domain/library.ts'
import type { Assets, Library, Painting, Workspace } from '../domain/types.ts'
import { readLibraryPack } from '../packs/libraryPack.ts'
import { idbStorage } from '../storage/persistence.ts'
import type { WorkspaceStorage } from '../storage/persistence.ts'

const AUTOSAVE_MS = 600

/**
 * What `importPack` did: `opened` the pack as the library (none was open), `merged` it into the
 * open library of the same namespace, or `copied` its paintings into the open library of another
 * namespace as new unpublished ones. `kept` counts local paintings a merge left as they were
 * (re-importing the same pack: added 0, kept n).
 */
export interface ImportResult {
  kind: 'opened' | 'merged' | 'copied'
  added: number
  kept: number
  sourceName: string
  sourceNamespace: string
}

export interface WorkspaceState extends Workspace {
  ready: boolean
  saveError: ShapeErrorCode | null
  /** The open library is the built-in demo (R23): set by openSampleLibrary, persisted locally. */
  demo: boolean
  init(storage?: WorkspaceStorage): Promise<void>
  /**
   * Replaces the open library with an empty one, deleting its paintings and their assets.
   * Ask first when `unexportedCount()` is above 0.
   */
  createLibrary(name: string, namespace: string): void
  /** Opens, merges or copies a library pack (R21); throws a ShapeError and changes nothing on bad bytes. */
  importPack(bytes: Uint8Array): ImportResult
  /** Moves the given loose paintings (all of them by default) into the open library; returns how many. */
  addLooseToLibrary(ids?: string[]): number
  createPainting(): string
  savePainting(p: Painting): void
  /**
   * Sets a painting's title. While unpublished its id follows the title (R17); returns the id it
   * has now, which callers holding the old id (editor, navigation) must switch to.
   */
  retitlePainting(id: string, title: string): string
  deletePainting(id: string): void
  /** Copies a painting right after the original, titled `${title} ${titleSuffix}`; returns its id. */
  duplicatePainting(id: string, titleSuffix: string): string
  putAsset(bytes: Uint8Array): string
  setAsset(id: string, bytes: Uint8Array): void
  /** Deletes assets no library or loose painting refers to, except the ids in `keep`. */
  pruneUnreferencedAssets(keep?: string[]): void
  /** Stores the library a pack was built from, stamping `exportedAt` (now) if it has none. */
  applyExport(library: Library): void
  /**
   * How many paintings of the open library no downloaded pack holds (R15): closing or replacing
   * the library deletes them. In the demo, paintings never changed since created don't count.
   */
  unexportedCount(): number
  /** Closes the open library, deleting its paintings and their assets. Ask first (see unexportedCount). */
  closeLibrary(): void
  findPainting(id: string): Painting | undefined
}

/** Asset ids a painting stores: source picture, edit layer and edit mask. */
function assetIdsOf(p: Painting): string[] {
  const ids: string[] = []
  if (p.recipe.source) ids.push(p.recipe.source.imageId)
  if (p.recipe.editsId) ids.push(p.recipe.editsId, `${p.recipe.editsId}.mask`)
  return ids
}

/** Drops the candidate asset ids unless a remaining painting still references them. */
function pruneAssets(assets: Assets, candidates: string[], remaining: Painting[]): Assets {
  const used = new Set(remaining.flatMap(assetIdsOf))
  const drop = candidates.filter((id) => !used.has(id) && id in assets)
  if (drop.length === 0) return assets
  const next = { ...assets }
  for (const id of drop) delete next[id]
  return next
}

const allPaintings = (s: Workspace): Painting[] => [...(s.library?.paintings ?? []), ...s.loose]

export function createWorkspaceStore(
  initialStorage: WorkspaceStorage,
  options: { flushOnHide?: boolean } = {},
) {
  let storage = initialStorage
  let timer: ReturnType<typeof setTimeout> | undefined
  let unsubscribe: (() => void) | undefined
  let saving: Promise<void> | null = null
  let dirty = false
  let initializing: Promise<void> | null = null
  let hideListenersAdded = false

  const store = create<WorkspaceState>()((set, get) => {
    const freshId = (title: string) => {
      const taken = new Set(allPaintings(get()).map((p) => p.id))
      let id = makePaintingId(title, Math.random)
      while (taken.has(id)) id = makePaintingId(title, Math.random)
      return id
    }
    const freshAssetId = (assets: Assets) => {
      let id = makeAssetId(Math.random)
      while (id in assets) id = makeAssetId(Math.random)
      return id
    }

    const flush = async () => {
      const { library, loose, assets, demo } = get()
      try {
        await storage.save({ library, loose, assets, demo })
        if (get().saveError !== null) set({ saveError: null })
      } catch (e) {
        if (e instanceof Error && e.name === 'QuotaExceededError') {
          set({ saveError: 'storage-full' })
        } else {
          console.error('Autosave failed', e)
        }
      }
    }

    // Saves never overlap: a request during a save marks it dirty and one more save follows.
    const requestFlush = (): Promise<void> => {
      if (saving) {
        dirty = true
        return saving
      }
      saving = (async () => {
        do {
          dirty = false
          await flush()
        } while (dirty)
      })().finally(() => {
        saving = null
      })
      return saving
    }

    const flushNow = () => {
      if (timer === undefined) return
      clearTimeout(timer)
      timer = undefined
      void requestFlush()
    }

    const addHideListeners = () => {
      if (!options.flushOnHide || hideListenersAdded || typeof window === 'undefined') return
      hideListenersAdded = true
      window.addEventListener('pagehide', flushNow)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushNow()
      })
    }

    const startAutosave = () => {
      unsubscribe?.()
      unsubscribe = store.subscribe((state, prev) => {
        if (
          state.library === prev.library &&
          state.loose === prev.loose &&
          state.assets === prev.assets &&
          state.demo === prev.demo
        ) {
          return
        }
        clearTimeout(timer)
        timer = setTimeout(() => {
          timer = undefined
          void requestFlush()
        }, AUTOSAVE_MS)
      })
    }

    return {
      library: null,
      loose: [],
      assets: {},
      ready: false,
      saveError: null,
      demo: false,

      init(next) {
        if (initializing) return initializing
        if (get().ready && !next) return Promise.resolve()
        if (next) storage = next
        unsubscribe?.()
        clearTimeout(timer)
        initializing = (async () => {
          try {
            const loaded = await storage.load()
            set({
              library: loaded?.library ?? null,
              loose: loaded?.loose ?? [],
              assets: loaded?.assets ?? {},
              demo: loaded?.demo ?? false,
              ready: true,
            })
            startAutosave()
            addHideListeners()
          } finally {
            initializing = null
          }
        })()
        return initializing
      },

      createLibrary(name, namespace) {
        if (!isValidNamespace(namespace)) throw new Error(`Invalid namespace: ${namespace}`)
        const { library, loose, assets } = get()
        set({
          library: newLibrary(name, namespace),
          demo: false,
          assets: library
            ? pruneAssets(assets, library.paintings.flatMap(assetIdsOf), loose)
            : assets,
        })
      },

      importPack(bytes) {
        const pack = readLibraryPack(bytes)
        const { library, loose, assets } = get()
        const source = { sourceName: pack.library.name, sourceNamespace: pack.library.namespace }
        const count = pack.library.paintings.length
        if (!library) {
          set({ library: pack.library, assets: { ...assets, ...pack.assets }, demo: false })
          return { kind: 'opened', added: count, kept: 0, ...source }
        }
        if (library.namespace !== pack.library.namespace) {
          // Another library: its paintings join this one as new, unpublished copies.
          const takenIds = new Set(allPaintings(get()).map((p) => p.id))
          const takenAssetIds = new Set(Object.keys(assets))
          const nextAssets = { ...assets }
          const copies = pack.library.paintings.map((p) => {
            const copy = copyAsNew(p, {
              title: p.title,
              takenIds,
              takenAssetIds,
              now: new Date(),
              random: Math.random,
            })
            takenIds.add(copy.painting.id)
            for (const [from, to] of Object.entries(copy.assetIds)) {
              takenAssetIds.add(to)
              const data = pack.assets[from]
              if (data) nextAssets[to] = data
            }
            return copy.painting
          })
          set({
            library: { ...library, paintings: [...library.paintings, ...copies] },
            assets: nextAssets,
          })
          return { kind: 'copied', added: count, kept: 0, ...source }
        }
        const merged = mergeLibraries(library, pack.library)
        // Added paintings and published copies that replaced local ones come from the pack.
        const incoming = new Set([...merged.added, ...pack.library.paintings])
        const nextAssets = { ...assets }
        for (const p of merged.library.paintings) {
          if (!incoming.has(p)) continue
          for (const id of assetIdsOf(p)) {
            const data = pack.assets[id]
            if (data) nextAssets[id] = data
          }
        }
        // A local draft replaced by a published copy no longer needs its own assets.
        const kept = new Set(merged.library.paintings)
        const dropped = library.paintings.filter((p) => !kept.has(p))
        set({
          library: merged.library,
          assets: pruneAssets(nextAssets, dropped.flatMap(assetIdsOf), [
            ...merged.library.paintings,
            ...loose,
          ]),
        })
        return { kind: 'merged', added: merged.added.length, kept: merged.kept.length, ...source }
      },

      addLooseToLibrary(ids) {
        const { library, loose } = get()
        if (!library) return 0
        const chosen = ids ? new Set(ids) : null
        const moving = chosen ? loose.filter((p) => chosen.has(p.id)) : loose
        if (moving.length === 0) return 0
        set({
          library: addLoosePaintings(library, moving, Math.random),
          loose: chosen ? loose.filter((p) => !chosen.has(p.id)) : [],
        })
        return moving.length
      },

      createPainting() {
        const p0 = newPainting({}, new Date(), Math.random)
        const p = { ...p0, id: freshId(p0.title) }
        const { library, loose } = get()
        if (library) set({ library: upsertPainting(library, p) })
        else set({ loose: [...loose, p] })
        return p.id
      },

      savePainting(p) {
        const { library, loose } = get()
        if (library?.paintings.some((q) => q.id === p.id)) {
          set({ library: upsertPainting(library, p) })
        } else if (loose.some((q) => q.id === p.id)) {
          set({ loose: loose.map((q) => (q.id === p.id ? p : q)) })
        } else if (library) {
          set({ library: upsertPainting(library, p) })
        } else {
          set({ loose: [...loose, p] })
        }
      },

      retitlePainting(id, title) {
        const { library, loose } = get()
        const target = get().findPainting(id)
        if (!target) throw new Error(`No painting ${id}`)
        if (target.title === title) return id
        const others = new Set(allPaintings(get()).map((p) => p.id))
        others.delete(id)
        const next = retitlePainting(target, title, others, new Date(), Math.random)
        const swap = (list: Painting[]) => list.map((p) => (p.id === id ? next : p))
        if (library?.paintings.some((p) => p.id === id)) {
          set({ library: { ...library, paintings: swap(library.paintings) } })
        } else {
          set({ loose: swap(loose) })
        }
        return next.id
      },

      deletePainting(id) {
        const target = get().findPainting(id)
        if (!target) return
        const { library, loose, assets } = get()
        const inLibrary = library?.paintings.some((p) => p.id === id) ?? false
        const nextLibrary = library && inLibrary ? removePainting(library, id) : library
        const nextLoose = inLibrary ? loose : loose.filter((p) => p.id !== id)
        const remaining = [...(nextLibrary?.paintings ?? []), ...nextLoose]
        set({
          library: nextLibrary,
          loose: nextLoose,
          assets: pruneAssets(assets, assetIdsOf(target), remaining),
        })
      },

      duplicatePainting(id, titleSuffix) {
        const original = get().findPainting(id)
        if (!original) throw new Error(`No painting ${id}`)
        // The copy gets its own asset ids so editing one painting never changes the other.
        const { library, loose, assets } = get()
        const { painting: copy, assetIds } = copyAsNew(original, {
          title: `${original.title} ${titleSuffix}`.trim(),
          takenIds: new Set(allPaintings(get()).map((p) => p.id)),
          takenAssetIds: new Set(Object.keys(assets)),
          now: new Date(),
          random: Math.random,
        })
        const nextAssets = { ...assets }
        for (const [from, to] of Object.entries(assetIds)) {
          const data = assets[from]
          if (data) nextAssets[to] = data
        }
        const inLibrary = library?.paintings.some((p) => p.id === id) ?? false
        if (library && inLibrary) {
          set({
            library: { ...library, paintings: insertAfter(library.paintings, id, copy) },
            assets: nextAssets,
          })
        } else {
          set({ loose: insertAfter(loose, id, copy), assets: nextAssets })
        }
        return copy.id
      },

      putAsset(bytes) {
        const id = freshAssetId(get().assets)
        set({ assets: { ...get().assets, [id]: bytes } })
        return id
      },

      setAsset(id, bytes) {
        set({ assets: { ...get().assets, [id]: bytes } })
      },

      pruneUnreferencedAssets(keep = []) {
        const { assets } = get()
        const used = new Set([...allPaintings(get()).flatMap(assetIdsOf), ...keep])
        const unused = Object.keys(assets).filter((id) => !used.has(id))
        if (unused.length > 0) set({ assets: pruneAssets(assets, unused, allPaintings(get())) })
      },

      applyExport(library) {
        set({ library: { ...library, exportedAt: library.exportedAt ?? new Date().toISOString() } })
      },

      unexportedCount() {
        const { library, demo } = get()
        if (!library) return 0
        const atRisk = unexportedPaintings(library)
        return demo ? atRisk.filter((p) => p.updatedAt !== p.createdAt).length : atRisk.length
      },

      closeLibrary() {
        const { library, loose, assets } = get()
        if (!library) return
        set({
          library: null,
          demo: false,
          assets: pruneAssets(assets, library.paintings.flatMap(assetIdsOf), loose),
        })
      },

      findPainting(id) {
        return allPaintings(get()).find((p) => p.id === id)
      },
    }
  })

  return store
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>

export const useWorkspace: WorkspaceStore = createWorkspaceStore(idbStorage, { flushOnHide: true })
