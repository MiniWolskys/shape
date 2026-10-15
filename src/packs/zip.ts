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

export function unzipEntries(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes)
  } catch (e) {
    throw new ShapeError(
      'not-a-library-pack',
      `This file is not a Shape library pack (it is not a readable zip: ${e instanceof Error ? e.message : String(e)}).`,
    )
  }
}
