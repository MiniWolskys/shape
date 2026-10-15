import { create } from 'zustand'
import type { ShapeErrorCode } from '../domain/errors.ts'
import { isValidNamespace, makeAssetId, makePaintingId } from '../domain/ids.ts'
import {
  addLoosePaintings,
  createLibrary as newLibrary,
  createPainting as newPainting,
  mergeLibraries,
  removePainting,
  upsertPainting,
} from '../domain/library.ts'
import type { Assets, Library, Painting, Workspace } from '../domain/types.ts'
import { readLibraryPack } from '../packs/libraryPack.ts'
import { idbStorage } from '../storage/persistence.ts'
import type { WorkspaceStorage } from '../storage/persistence.ts'

const AUTOSAVE_MS = 600

export interface WorkspaceState extends Workspace {
  ready: boolean
  hasSavedWork: boolean
  saveError: ShapeErrorCode | null
  init(storage?: WorkspaceStorage): Promise<void>
  createLibrary(name: string, namespace: string): void
  openLibraryPack(bytes: Uint8Array): { added: number; kept: number }
  addLooseToLibrary(): number
  createPainting(): string
  savePainting(p: Painting): void
  deletePainting(id: string): void
  duplicatePainting(id: string): string
  putAsset(bytes: Uint8Array): string
  setAsset(id: string, bytes: Uint8Array): void
  applyExport(library: Library): void
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
      const { library, loose, assets } = get()
      try {
        await storage.save({ library, loose, assets })
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
          state.assets === prev.assets
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
      hasSavedWork: false,
      saveError: null,

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
              hasSavedWork: !!loaded && (loaded.library !== null || loaded.loose.length > 0),
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
          assets: library
            ? pruneAssets(assets, library.paintings.flatMap(assetIdsOf), loose)
            : assets,
        })
      },

      openLibraryPack(bytes) {
        const pack = readLibraryPack(bytes)
        const { library, assets } = get()
        if (!library) {
          set({ library: pack.library, assets: { ...assets, ...pack.assets } })
          return { added: pack.library.paintings.length, kept: 0 }
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
            ...get().loose,
          ]),
        })
        return { added: merged.added.length, kept: merged.kept.length }
      },

      addLooseToLibrary() {
        const { library, loose } = get()
        if (!library || loose.length === 0) return 0
        set({ library: addLoosePaintings(library, loose, Math.random), loose: [] })
        return loose.length
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

      duplicatePainting(id) {
        const original = get().findPainting(id)
        if (!original) throw new Error(`No painting ${id}`)
        // The copy gets its own asset ids so editing one painting never changes the other.
        const assets = { ...get().assets }
        const copyAsset = (from: string, to: string) => {
          const data = assets[from]
          if (data) assets[to] = data
        }
        const recipe = { ...original.recipe }
        if (recipe.source) {
          const imageId = freshAssetId(assets)
          copyAsset(recipe.source.imageId, imageId)
          recipe.source = { ...recipe.source, imageId }
        }
        if (recipe.editsId) {
          const editsId = freshAssetId(assets)
          copyAsset(recipe.editsId, editsId)
          copyAsset(`${recipe.editsId}.mask`, `${editsId}.mask`)
          recipe.editsId = editsId
        }
        const stamp = new Date().toISOString()
        const copy: Painting = {
          ...original,
          id: freshId(original.title),
          status: 'draft',
          createdAt: stamp,
          updatedAt: stamp,
          recipe,
        }
        delete copy.publishedIn
        const { library, loose } = get()
        const inLibrary = library?.paintings.some((p) => p.id === id) ?? false
        if (library && inLibrary) set({ library: upsertPainting(library, copy), assets })
        else set({ loose: [...loose, copy], assets })
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

      applyExport(library) {
        set({ library })
      },

      closeLibrary() {
        const { library, loose, assets } = get()
        if (!library) return
        set({
          library: null,
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
