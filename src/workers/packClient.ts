import { ShapeError, type ShapeErrorCode } from '../domain/errors.ts'
import type { Assets, Library } from '../domain/types.ts'
import { writeLibraryPack, type LibraryPackResult } from '../packs/libraryPack.ts'

export interface PackRequest {
  library: Library
  selectedIds: string[]
  assets: Assets
  /** ISO time of the export. */
  now: string
  /** Build the current version again, or a backup of it, publishing nothing (see writeLibraryPack). */
  again: boolean
  backup: boolean
}

export type PackReply =
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'packed'; result: LibraryPackResult }
  | { kind: 'failed'; code: ShapeErrorCode | null; message: string; painting?: string }

type Progress = (done: number, total: number) => void

/** Builds on this thread; a short pause first lets the busy state paint. */
async function buildHere(request: PackRequest, onProgress: Progress): Promise<LibraryPackResult> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  const { library, selectedIds, assets, now, again, backup } = request
  return writeLibraryPack(library, selectedIds, assets, new Date(now), onProgress, {
    again,
    backup,
  })
}

/**
 * Builds the library pack (see writeLibraryPack) in a worker, so the page stays responsive,
 * reporting each painting as it starts rendering. Without workers, or if the worker cannot
 * start, it builds on this thread. Errors keep their ShapeError code. Aborting `signal` stops
 * the worker and rejects with an AbortError (a build on this thread runs to its end).
 */
export function buildLibraryPack(
  library: Library,
  selectedIds: string[],
  assets: Assets,
  now: Date,
  onProgress: Progress,
  signal?: AbortSignal,
  options: { again?: boolean; backup?: boolean } = {},
): Promise<LibraryPackResult> {
  const request: PackRequest = {
    library,
    selectedIds,
    assets,
    now: now.toISOString(),
    again: options.again ?? false,
    backup: options.backup ?? false,
  }
  if (typeof Worker !== 'function') return buildHere(request, onProgress)
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./pack.worker.ts', import.meta.url), { type: 'module' })
    } catch (error) {
      console.error('Could not start the export worker; building on the page instead', error)
      resolve(buildHere(request, onProgress))
      return
    }
    worker.onmessage = (event: MessageEvent<PackReply>) => {
      const reply = event.data
      if (reply.kind === 'progress') {
        onProgress(reply.done, reply.total)
        return
      }
      worker.terminate()
      signal?.removeEventListener('abort', stop)
      if (reply.kind === 'packed') resolve(reply.result)
      else if (reply.code) reject(new ShapeError(reply.code, reply.message, reply.painting))
      else reject(new Error(reply.message))
    }
    const stop = () => {
      worker.terminate()
      reject(new DOMException('The export was cancelled', 'AbortError'))
    }
    if (signal?.aborted) return stop()
    signal?.addEventListener('abort', stop, { once: true })
    worker.onerror = (event) => {
      console.error('The export worker stopped; building on the page instead', event.message)
      worker.terminate()
      signal?.removeEventListener('abort', stop)
      resolve(buildHere(request, onProgress))
    }
    worker.postMessage(request)
  })
}
