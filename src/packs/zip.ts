import { unzipSync, zipSync, type Zippable } from 'fflate'
import { ShapeError } from '../domain/errors.ts'

/** Same files in, same bytes out: entries sorted by path, fixed timestamps, deflate level 9. */
export function zipDeterministic(files: Record<string, Uint8Array>): Uint8Array {
  // fflate writes the DOS timestamp from the Date's local-time fields, so a Date built from local
  // fields gives 1980-01-01 00:00:00 in every time zone (an epoch number would shift with the zone).
  // It is built per call so a time zone change after module load cannot move it.
  const mtime = new Date(1980, 0, 1, 0, 0, 0)
  const sorted: Zippable = {}
  for (const path of Object.keys(files).sort()) {
    const data = files[path]
    if (data) sorted[path] = [data, { level: 9, mtime, os: 0, attrs: 0 }]
  }
  return zipSync(sorted)
}

/** No entry Shape reads comes near this: a 2048 px RGBA picture is at most about 17 MB. */
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024

/**
 * The zip's entries that `keep` accepts (all by default), inflated. Nothing else is inflated,
 * so a large or hostile zip can't freeze the tab; a kept entry larger than `maxEntryBytes`
 * refuses the whole file.
 */
export function unzipEntries(
  bytes: Uint8Array,
  options: { keep?: (name: string) => boolean; maxEntryBytes?: number } = {},
): Record<string, Uint8Array> {
  const { keep = () => true, maxEntryBytes = MAX_ENTRY_BYTES } = options
  let tooLarge: string | null = null
  try {
    return unzipSync(bytes, {
      filter(file) {
        if (!keep(file.name)) return false
        if (file.originalSize > maxEntryBytes) {
          tooLarge = file.name
          throw new Error(`${file.name} is too large`)
        }
        return true
      },
    })
  } catch (e) {
    const why =
      tooLarge === null
        ? `it is not a readable zip: ${e instanceof Error ? e.message : String(e)}`
        : `${tooLarge} is too large`
    throw new ShapeError('not-a-library-pack', `This file is not a Shape library pack (${why}).`)
  }
}
