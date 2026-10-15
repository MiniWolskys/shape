import { del, get, keys, set } from 'idb-keyval'
import type { Assets, Library, Painting, Workspace } from '../domain/types.ts'

/** A stored workspace, with how many of the assets its record lists were not found. */
export type LoadedWorkspace = Workspace & { missingAssets?: number }

export interface WorkspaceStorage {
  load(): Promise<LoadedWorkspace | null>
  save(w: Workspace): Promise<void>
  clear(): Promise<void>
}

const WORKSPACE_KEY = 'shape:workspace:v1'
const ASSET_PREFIX = 'shape:assets:'
const assetKey = (id: string) => `${ASSET_PREFIX}${id}`

/**
 * Deletes asset keys the record does not list: a crash between writing an asset and writing
 * the record leaves them behind, and pictures are large.
 */
async function sweepOrphans(listed: ReadonlySet<string>): Promise<void> {
  for (const key of await keys()) {
    if (typeof key !== 'string' || !key.startsWith(ASSET_PREFIX)) continue
    if (!listed.has(key.slice(ASSET_PREFIX.length))) await del(key)
  }
}

interface WorkspaceRecord {
  library: Library | null
  loose: Painting[]
  assetIds: string[]
  /** Absent in records saved before the demo flag existed. */
  demo?: boolean
  demoIds?: string[]
}

export function createIdbStorage(): WorkspaceStorage {
  // Byte arrays already in IndexedDB, so each save writes only new or replaced ones.
  const written = new Map<string, Uint8Array>()
  return {
    async load() {
      // What another tab may have written since: only what this load reads counts as written.
      written.clear()
      const record = await get<WorkspaceRecord>(WORKSPACE_KEY)
      await sweepOrphans(new Set(record?.assetIds ?? []))
      if (!record) return null
      const assets: Assets = {}
      let missingAssets = 0
      for (const id of record.assetIds) {
        const bytes = await get<Uint8Array>(assetKey(id))
        if (bytes) {
          assets[id] = bytes
          written.set(id, bytes)
        } else {
          console.warn(`Stored asset ${id} is missing and was skipped`)
          missingAssets++
        }
      }
      return {
        library: record.library,
        loose: record.loose,
        assets,
        demo: record.demo ?? false,
        demoIds: record.demoIds ?? [],
        missingAssets,
      }
    },

    async save(w) {
      const previous = await get<WorkspaceRecord>(WORKSPACE_KEY)
      const ids = Object.keys(w.assets)
      for (const id of ids) {
        const bytes = w.assets[id]
        if (bytes && written.get(id) !== bytes) {
          await set(assetKey(id), bytes)
          written.set(id, bytes)
        }
      }
      const record: WorkspaceRecord = {
        library: w.library,
        loose: w.loose,
        assetIds: ids,
        demo: w.demo ?? false,
        demoIds: w.demoIds ?? [],
      }
      await set(WORKSPACE_KEY, record)
      const keep = new Set(ids)
      for (const id of previous?.assetIds ?? []) {
        if (!keep.has(id)) {
          await del(assetKey(id))
          written.delete(id)
        }
      }
    },

    async clear() {
      const previous = await get<WorkspaceRecord>(WORKSPACE_KEY)
      for (const id of previous?.assetIds ?? []) await del(assetKey(id))
      await del(WORKSPACE_KEY)
      written.clear()
    },
  }
}

export const idbStorage: WorkspaceStorage = createIdbStorage()

export function memoryStorage(): WorkspaceStorage {
  let stored: Workspace | null = null
  return {
    load: () => Promise.resolve(stored ? structuredClone(stored) : null),
    save: (w) => {
      stored = structuredClone(w)
      return Promise.resolve()
    },
    clear: () => {
      stored = null
      return Promise.resolve()
    },
  }
}
