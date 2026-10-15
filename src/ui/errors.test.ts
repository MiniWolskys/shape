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
    expect(
      errorMessage(new ShapeError('export-failed', 'disk on fire'), en, { reason: 'try again' }),
    ).toBe('The export failed: try again')
  })

  it('never shows developer text, which is in English (logged instead)', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failed = new ShapeError('export-failed', 'disk on fire')
    expect(errorMessage(failed, fr)).not.toMatch(/disk/)
    expect(errorMessage(failed, fr)).toMatch(/^L’export a échoué/)
    expect(log).toHaveBeenCalledWith(failed)
  })

  it('gives unknown errors a generic message and logs them', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new TypeError('boom')
    expect(errorMessage(error, en)).toBe(en.errors.unexpected)
    expect(errorMessage(error, fr)).not.toMatch(/boom/)
    expect(log).toHaveBeenCalledWith(error)
  })
})
