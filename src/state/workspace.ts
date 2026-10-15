import { create } from 'zustand'
import { isValidNamespace, makeAssetId, makePaintingId } from '../domain/ids.ts'
import {
  addLoosePaintings,
  copyAsNew,
  createLibrary as newLibrary,
  createPainting as newPainting,
  insertAfter,
  mergeLibraries,
  notAfter,
  removePainting,
  retitlePainting,
  unexportedPaintings,
  upsertPainting,
} from '../domain/library.ts'
import type { Assets, Library, Painting, Workspace } from '../domain/types.ts'
import { readLibraryPack } from '../packs/libraryPack.ts'
import { idbStorage } from '../storage/persistence.ts'
import { withWorkspaceIo } from './tabLock.ts'
import type { WorkspaceStorage } from '../storage/persistence.ts'

const AUTOSAVE_MS = 600

/** A library pack as readLibraryPack returns it. */
export type ReadPack = ReturnType<typeof readLibraryPack>

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

/**
 * Why the workspace is not being saved (C1): the browser's storage is full, or it refused the
 * write for another reason (a lost connection, a full disk, a private window's limits).
 */
export type SaveError = 'storage-full' | 'storage-failed'

export interface WorkspaceState extends Workspace {
  ready: boolean
  /** Set while saving to the browser storage fails; the next change tries again (C1). */
  saveError: SaveError | null
  /** How many stored pictures or edit layers were missing when the workspace was loaded. */
  missingAssets: number
  /** The open library is the built-in demo (R23): set by openSampleLibrary, persisted locally. */
  demo: boolean
  /** The demo's sample paintings as built; untouched ones are not counted as unexported. */
  demoIds: string[]
  init(storage?: WorkspaceStorage): Promise<void>
  /**
   * Replaces the open library with an empty one, deleting its paintings and their assets.
   * Ask first when `unexportedCount()` is above 0.
   */
  createLibrary(name: string, namespace: string): void
  /**
   * Opens, merges or copies a library pack (R21), given as its bytes or as readLibraryPack read
   * it. With the demo open, the pack replaces it (R25): ask first (see unexportedCount). Throws a
   * ShapeError and changes nothing on bad bytes.
   */
  importPack(input: Uint8Array | ReadPack): ImportResult
  /** Moves the given loose paintings (all of them by default) into the open library; returns how many. */
  addLooseToLibrary(ids?: string[]): number
  /** A new painting in the open library, or loose without one or with the demo open (R23). */
  createPainting(): string
  /**
   * A new painting with an id no painting has, not added anywhere (R18): the editor shows it
   * and `savePainting` adds it on its first change.
   */
  draftPainting(): Painting
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
  /** Writes pending changes to storage now instead of after the autosave delay. */
  persistNow(): Promise<void>
  /**
   * Stops writing to storage at once, pending saves included: another tab took over (R38) and
   * owns the stored workspace now. Only a new `init` saves again.
   */
  suspend(): void
  /** Resolves once the save in flight, if any, has finished. */
  whenSaved(): Promise<void>
  /**
   * Takes over what an export changed (version, `exportedAt` — now if it has none — and the
   * paintings it published) into the open library as it is now. Ignored when that library is
   * no longer open.
   */
  applyExport(library: Library): void
  /**
   * How many paintings of the open library no downloaded pack holds (R15): closing or replacing
   * the library deletes them. In the demo, sample paintings left as built don't count.
   */
  unexportedCount(): number
  /**
   * Moves the demo paintings the player made or changed (those unexportedCount counts) out of
   * the demo into the loose paintings, so closing the demo keeps them; returns how many.
   */
  keepDemoWork(): number
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
  const drop = candidates.filter((id) => !used.has(id) && Object.hasOwn(assets, id))
  if (drop.length === 0) return assets
  const next = { ...assets }
  for (const id of drop) delete next[id]
  return next
}

/** Whether two byte arrays (either possibly absent) hold the same bytes. */
export function sameBytes(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const own = (assets: Assets, id: string): Uint8Array | undefined =>
  Object.hasOwn(assets, id) ? assets[id] : undefined

/**
 * Copies a pack painting's assets from `from` into `into` (mutated) and returns the painting.
 * An asset id that already holds other bytes here belongs to another painting (ids follow
 * shared history between packs): the incoming painting gets a fresh id for it instead, so an
 * import never changes a local painting (C2). Identical bytes stay shared.
 */
function adoptAssets(p: Painting, from: Assets, into: Assets): Painting {
  const taken = (id: string) => Object.hasOwn(into, id) || Object.hasOwn(from, id)
  const fresh = (withMask: boolean) => {
    let id = makeAssetId(Math.random)
    while (taken(id) || (withMask && taken(`${id}.mask`))) id = makeAssetId(Math.random)
    return id
  }
  const clashes = (id: string) =>
    Object.hasOwn(into, id) && !sameBytes(own(into, id), own(from, id))
  const copy = (fromId: string, toId: string) => {
    const data = own(from, fromId)
    if (data) into[toId] = data
  }
  let recipe = p.recipe
  const source = recipe.source
  if (source) {
    const imageId = clashes(source.imageId) ? fresh(false) : source.imageId
    copy(source.imageId, imageId)
    if (imageId !== source.imageId) recipe = { ...recipe, source: { ...source, imageId } }
  }
  const edits = recipe.editsId
  if (edits) {
    const editsId = clashes(edits) || clashes(`${edits}.mask`) ? fresh(true) : edits
    copy(edits, editsId)
    copy(`${edits}.mask`, `${editsId}.mask`)
    if (editsId !== edits) recipe = { ...recipe, editsId }
  }
  return recipe === p.recipe ? p : { ...p, recipe }
}

const NO_DEMO = { demo: false, demoIds: [] as string[] }

const allPaintings = (s: Workspace): Painting[] => [...(s.library?.paintings ?? []), ...s.loose]

/** Quota errors carry this name in every browser (DOMException code 22 in older ones). */
const isQuotaError = (e: unknown) =>
  e instanceof Error && (e.name === 'QuotaExceededError' || (e as { code?: unknown }).code === 22)

/** Asks the browser not to evict the workspace under storage pressure or after a week (I5). */
function askToPersist(): void {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
  if (typeof storage?.persist !== 'function') return
  storage.persist().then(
    (granted) => {
      if (!granted) console.info('The browser may clear the workspace under storage pressure')
    },
    (error: unknown) => console.warn('Could not ask the browser to keep the workspace', error),
  )
}

export function createWorkspaceStore(
  initialStorage: WorkspaceStorage,
  options: {
    flushOnHide?: boolean
    persistStorage?: boolean
    /**
     * Runs each read and write of the storage (R38): with withWorkspaceIo, a tab that takes over
     * reads only once the old tab's save in flight is done. Runs them as they come by default.
     */
    ioLock?: <T>(task: () => Promise<T>) => Promise<T>
  } = {},
) {
  const io = options.ioLock ?? (<T>(task: () => Promise<T>) => task())
  let storage = initialStorage
  let timer: ReturnType<typeof setTimeout> | undefined
  let unsubscribe: (() => void) | undefined
  let saving: Promise<void> | null = null
  let dirty = false
  let initializing: Promise<void> | null = null
  let hideListenersAdded = false
  let persistAsked = false
  let suspended = false

  const store = create<WorkspaceState>()((set, get) => {
    const freshId = (title: string) => {
      const taken = new Set(allPaintings(get()).map((p) => p.id))
      let id = makePaintingId(title, Math.random)
      while (taken.has(id)) id = makePaintingId(title, Math.random)
      return id
    }
    const freshAssetId = (assets: Assets) => {
      let id = makeAssetId(Math.random)
      while (Object.hasOwn(assets, id)) id = makeAssetId(Math.random)
      return id
    }

    /** The open library's paintings that closing it would lose (R15). */
    const atRisk = (): Painting[] => {
      const { library, demo, demoIds } = get()
      if (!library) return []
      const unexported = unexportedPaintings(library)
      if (!demo) return unexported
      // Only sample paintings left as built are safe to drop.
      const samples = new Set(demoIds)
      return unexported.filter((p) => !(samples.has(p.id) && p.updatedAt === p.createdAt))
    }

    const flush = async () => {
      if (suspended) return
      try {
        const saved = await io(async () => {
          // Another tab may have taken over while this save waited for the storage.
          if (suspended) return false
          const { library, loose, assets, demo, demoIds } = get()
          await storage.save({ library, loose, assets, demo, demoIds })
          return true
        })
        if (!saved) return
        if (get().saveError !== null) set({ saveError: null })
        if (options.persistStorage && !persistAsked) {
          persistAsked = true
          askToPersist()
        }
      } catch (e) {
        // Never silent (C1): the app shows it until a later save succeeds.
        console.error('Autosave failed', e)
        set({ saveError: isQuotaError(e) ? 'storage-full' : 'storage-failed' })
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
          state.demo === prev.demo &&
          state.demoIds === prev.demoIds
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
      missingAssets: 0,
      demo: false,
      demoIds: [],

      init(next) {
        if (initializing) return initializing
        if (get().ready && !next) return Promise.resolve()
        if (next) storage = next
        suspended = false
        unsubscribe?.()
        clearTimeout(timer)
        initializing = (async () => {
          try {
            const loaded = await io(() => storage.load())
            set({
              library: loaded?.library ?? null,
              loose: loaded?.loose ?? [],
              assets: loaded?.assets ?? {},
              demo: loaded?.demo ?? false,
              demoIds: loaded?.demoIds ?? [],
              missingAssets: loaded?.missingAssets ?? 0,
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
          ...NO_DEMO,
          assets: library
            ? pruneAssets(assets, library.paintings.flatMap(assetIdsOf), loose)
            : assets,
        })
      },

      importPack(input) {
        const pack = input instanceof Uint8Array ? readLibraryPack(input) : input
        const { library, loose, assets, demo } = get()
        const source = { sourceName: pack.library.name, sourceNamespace: pack.library.namespace }
        const count = pack.library.paintings.length
        // The demo counts as no library (R25): the pack replaces it.
        if (!library || demo) {
          const kept = library
            ? pruneAssets(assets, library.paintings.flatMap(assetIdsOf), loose)
            : assets
          // Loose paintings keep their own assets, whatever ids the pack uses.
          const nextAssets = { ...kept }
          const paintings = pack.library.paintings.map((p) =>
            adoptAssets(p, pack.assets, nextAssets),
          )
          // A friend's clock may run ahead: a later export time would hide changes made now.
          const { exportedAt } = pack.library
          const opened = {
            ...pack.library,
            ...(exportedAt === undefined ? {} : { exportedAt: notAfter(exportedAt, new Date()) }),
            paintings,
          }
          set({ library: opened, assets: nextAssets, ...NO_DEMO })
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
        const merged = mergeLibraries(library, pack.library, new Date())
        // Added paintings and published copies that replaced local ones come from the pack.
        const incoming = new Set([...merged.added, ...pack.library.paintings])
        // A local draft replaced by a published copy no longer needs its own assets.
        const kept = new Set(merged.library.paintings)
        const dropped = library.paintings.filter((p) => !kept.has(p))
        const staying = merged.library.paintings.filter((p) => !incoming.has(p))
        const nextAssets = {
          ...pruneAssets(assets, dropped.flatMap(assetIdsOf), [...staying, ...loose]),
        }
        const paintings = merged.library.paintings.map((p) =>
          incoming.has(p) ? adoptAssets(p, pack.assets, nextAssets) : p,
        )
        set({ library: { ...merged.library, paintings }, assets: nextAssets })
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
        const p = get().draftPainting()
        const { library, loose, demo } = get()
        if (library && !demo) set({ library: upsertPainting(library, p) })
        else set({ loose: [...loose, p] })
        return p.id
      },

      draftPainting() {
        const p = newPainting({}, new Date(), Math.random)
        return { ...p, id: freshId(p.title) }
      },

      savePainting(p) {
        const { library, loose, demo } = get()
        if (library?.paintings.some((q) => q.id === p.id)) {
          set({ library: upsertPainting(library, p) })
        } else if (loose.some((q) => q.id === p.id)) {
          set({ loose: loose.map((q) => (q.id === p.id ? p : q)) })
        } else if (library && !demo) {
          set({ library: upsertPainting(library, p) })
        } else {
          // A new painting never joins the demo: it would be lost with it (R23).
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

      persistNow() {
        clearTimeout(timer)
        timer = undefined
        return requestFlush()
      },

      whenSaved() {
        return saving ?? Promise.resolve()
      },

      suspend() {
        suspended = true
        unsubscribe?.()
        unsubscribe = undefined
        clearTimeout(timer)
        timer = undefined
      },

      applyExport(exported) {
        const current = get().library
        // The library may have been closed or replaced while the pack was built.
        if (!current || current.namespace !== exported.namespace) return
        // Only what the export changes is taken over; the rest stays as it is now.
        const published = new Map(
          exported.paintings
            .filter((p) => p.status === 'published' && p.publishedIn === exported.version)
            .map((p) => [p.id, p]),
        )
        const later = (a: string, b: string) => (Date.parse(a) > Date.parse(b) ? a : b)
        set({
          library: {
            ...current,
            version: exported.version,
            exportedAt: exported.exportedAt ?? new Date().toISOString(),
            paintings: current.paintings.map((p) => {
              const done = published.get(p.id)
              if (!done || p.status === 'published') return p
              return {
                ...p,
                status: 'published',
                publishedIn: done.publishedIn,
                // An edit made after the export started stays newer than it.
                updatedAt: later(p.updatedAt, done.updatedAt),
              }
            }),
          },
        })
      },

      unexportedCount() {
        return atRisk().length
      },

      keepDemoWork() {
        const { library, loose, demo } = get()
        if (!library || !demo) return 0
        const mine = new Set(atRisk())
        if (mine.size === 0) return 0
        set({
          library: { ...library, paintings: library.paintings.filter((p) => !mine.has(p)) },
          loose: [...loose, ...library.paintings.filter((p) => mine.has(p))],
        })
        return mine.size
      },

      closeLibrary() {
        const { library, loose, assets } = get()
        if (!library) return
        set({
          library: null,
          ...NO_DEMO,
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

export const useWorkspace: WorkspaceStore = createWorkspaceStore(idbStorage, {
  flushOnHide: true,
  persistStorage: true,
  ioLock: (task) => withWorkspaceIo(task),
})
