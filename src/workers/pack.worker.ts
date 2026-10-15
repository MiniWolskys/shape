import { ShapeError } from '../domain/errors.ts'
import { writeLibraryPack } from '../packs/libraryPack.ts'
import type { PackReply, PackRequest } from './packClient.ts'

/** The worker's global scope, typed by hand (the app is typed against the DOM). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PackRequest>) => void) | null
  postMessage(message: PackReply, transfer?: Transferable[]): void
}

scope.onmessage = async (event) => {
  const { library, selectedIds, assets, now, again, backup } = event.data
  try {
    const result = await writeLibraryPack(
      library,
      selectedIds,
      assets,
      new Date(now),
      (done, total) => scope.postMessage({ kind: 'progress', done, total }),
      { again, backup },
    )
    scope.postMessage({ kind: 'packed', result }, [result.bytes.buffer as ArrayBuffer])
  } catch (error) {
    const shapeError = error instanceof ShapeError ? error : null
    scope.postMessage({
      kind: 'failed',
      code: shapeError?.code ?? null,
      message: error instanceof Error ? error.message : String(error),
      ...(shapeError?.painting === undefined ? {} : { painting: shapeError.painting }),
    })
  }
}
