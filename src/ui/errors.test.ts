import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShapeError } from '../domain/errors.ts'
import { en } from '../i18n/en.ts'
import { fr } from '../i18n/fr.ts'
import { errorMessage } from './errors.ts'

describe('errorMessage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps each ShapeError code to its translated message', () => {
    expect(errorMessage(new ShapeError('not-an-image'), en)).toBe(en.errors.notAnImage)
    expect(errorMessage(new ShapeError('not-a-library-pack'), fr)).toBe(fr.errors.notALibraryPack)
    expect(errorMessage(new ShapeError('newer-format'), en)).toBe(en.errors.newerFormat)
    expect(errorMessage(new ShapeError('storage-full'), en)).toBe(en.errors.storageFull)
    expect(errorMessage(new ShapeError('published-locked'), en)).toBe(en.errors.publishedLocked)
  })

  it('fills placeholders', () => {
    expect(errorMessage(new ShapeError('namespace-mismatch'), en, { namespace: 'ours' })).toBe(
      "This pack doesn't belong to the open library (ours).",
    )
    expect(errorMessage(new ShapeError('export-failed', 'disk on fire'), en)).toBe(
      'The export failed: disk on fire',
    )
  })

  it('gives unknown errors a generic message and logs them', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new TypeError('boom')
    expect(errorMessage(error, en)).toBe('Something went wrong: boom')
    expect(log).toHaveBeenCalledWith(error)
  })
})
