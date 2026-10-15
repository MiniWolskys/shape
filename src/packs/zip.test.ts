import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShapeError } from '../domain/errors.ts'
import { unzipEntries, zipDeterministic } from './zip.ts'

const enc = (s: string) => new TextEncoder().encode(s)

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('deterministic zip', () => {
  it('round-trips entries', () => {
    const files = { 'b/two.txt': enc('two'), 'a.txt': enc('one') }
    const back = unzipEntries(zipDeterministic(files))
    expect(Object.keys(back).sort()).toEqual(['a.txt', 'b/two.txt'])
    expect(new TextDecoder().decode(back['b/two.txt'])).toBe('two')
  })

  it('gives the same bytes whatever the key order or time zone', () => {
    vi.stubEnv('TZ', 'Pacific/Kiritimati')
    const offsetA = new Date(0).getTimezoneOffset()
    const a = zipDeterministic({ 'z.txt': enc('z'), 'a.txt': enc('a') })
    vi.stubEnv('TZ', 'America/Los_Angeles')
    const offsetB = new Date(0).getTimezoneOffset()
    const b = zipDeterministic({ 'a.txt': enc('a'), 'z.txt': enc('z') })
    expect(offsetB).not.toBe(offsetA) // the zone really changed
    expect(Array.from(b)).toEqual(Array.from(a))
  })

  it('sorts entries and stamps them 1980-01-01 00:00', () => {
    const bytes = zipDeterministic({ 'z.txt': enc('z'), 'a.txt': enc('a') })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint16(10, true)).toBe(0) // DOS time
    expect(view.getUint16(12, true)).toBe((0 << 9) | (1 << 5) | 1) // DOS date 1980-01-01
    const nameLength = view.getUint16(26, true)
    expect(new TextDecoder().decode(bytes.subarray(30, 30 + nameLength))).toBe('a.txt')
  })

  it('inflates only the entries asked for, and refuses one that is too large (minor 3)', () => {
    const bytes = zipDeterministic({ 'keep.txt': enc('k'), 'skip.bin': enc('x'.repeat(5000)) })
    const kept = unzipEntries(bytes, { keep: (name) => name.startsWith('keep') })
    expect(Object.keys(kept)).toEqual(['keep.txt'])
    let error: unknown
    try {
      unzipEntries(bytes, { keep: () => true, maxEntryBytes: 1000 })
    } catch (e) {
      error = e
    }
    expect(error).toMatchObject({ code: 'not-a-library-pack' })
  })

  it('throws not-a-library-pack on bytes that are not a zip', () => {
    let error: unknown
    try {
      unzipEntries(new Uint8Array([1, 2, 3]))
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(ShapeError)
    expect((error as ShapeError).code).toBe('not-a-library-pack')
  })
})
