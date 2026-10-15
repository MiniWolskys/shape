import { del, get, set } from 'idb-keyval'
import type { Assets, Library, Painting, Workspace } from '../domain/types.ts'

export interface WorkspaceStorage {
  load(): Promise<Workspace | null>
  save(w: Workspace): Promise<void>
  clear(): Promise<void>
}

const WORKSPACE_KEY = 'shape:workspace:v1'
const assetKey = (id: string) => `shape:assets:${id}`

interface WorkspaceRecord {
  library: Library | null
  loose: Painting[]
  assetIds: string[]
  /** Absent in records saved before the demo flag existed. */
  demo?: boolean
}

export function createIdbStorage(): WorkspaceStorage {
  // Byte arrays already in IndexedDB, so each save writes only new or replaced ones.
  const written = new Map<string, Uint8Array>()
  return {
    async load() {
      const record = await get<WorkspaceRecord>(WORKSPACE_KEY)
      if (!record) return null
      const assets: Assets = {}
      for (const id of record.assetIds) {
        const bytes = await get<Uint8Array>(assetKey(id))
        if (bytes) {
          assets[id] = bytes
          written.set(id, bytes)
        } else {
          console.warn(`Stored asset ${id} is missing and was skipped`)
        }
      }
      return { library: record.library, loose: record.loose, assets, demo: record.demo ?? false }
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
