import { isChanged, unexportedPaintings } from '../../domain/library.ts'
import type { Library } from '../../domain/types.ts'

/**
 * What the main Export button will do (C5): publish new paintings into a new version, update
 * changed ones into a new version, download the current version again (only when that gives the
 * very same file), download a backup that keeps unpublished paintings (R35), or nothing yet.
 */
export type Plan =
  | { kind: 'publish'; count: number }
  | { kind: 'update'; count: number }
  | { kind: 'again' }
  | { kind: 'backup'; count: number }
  | { kind: 'nothing' }

/** The plan for exporting `selectedIds` (unpublished paintings) of `lib`. */
export function exportPlan(lib: Library, selectedIds: readonly string[]): Plan {
  if (selectedIds.length > 0) return { kind: 'publish', count: selectedIds.length }
  const changed = lib.paintings.filter((p) => isChanged(p, lib)).length
  if (changed > 0) return { kind: 'update', count: changed }
  if (lib.version < 1) return { kind: 'nothing' }
  const unexported = unexportedPaintings(lib).length
  return unexported === 0 ? { kind: 'again' } : { kind: 'backup', count: unexported }
}
