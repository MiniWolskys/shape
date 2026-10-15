import { ShapeError } from '../domain/errors.ts'
import type { Dictionary } from '../i18n/en.ts'
import { format } from '../i18n/i18n.ts'

/**
 * The translated message for an error shown to players. `values` fills placeholders such as
 * `{namespace}`; unknown errors get a generic message and are logged.
 */
export function errorMessage(
  error: unknown,
  t: Dictionary,
  values: Record<string, string | number> = {},
): string {
  const reason = error instanceof Error && error.message ? error.message : String(error)
  if (error instanceof ShapeError) {
    switch (error.code) {
      case 'not-an-image':
        return t.errors.notAnImage
      case 'not-a-library-pack':
        return t.errors.notALibraryPack
      case 'newer-format':
        return t.errors.newerFormat
      case 'namespace-mismatch':
        return format(t.errors.namespaceMismatch, { namespace: '', ...values })
      case 'storage-full':
        return t.errors.storageFull
      case 'published-locked':
        return t.errors.publishedLocked
      case 'export-failed':
        return format(t.errors.exportFailed, { reason, ...values })
    }
  }
  console.error(error)
  return format(t.errors.unexpected, { reason })
}
