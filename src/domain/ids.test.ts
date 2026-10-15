import { describe, expect, it } from 'vitest'
import { isValidNamespace, makeAssetId, makePaintingId, namespaceFromName, slugify } from './ids.ts'

const seq = (...values: number[]) => {
  let i = 0
  return () => values[i++ % values.length] ?? 0
}

describe('slugify', () => {
  it('lowercases, strips accents and replaces separators', () => {
    expect(slugify('Été à la Plage!')).toBe('ete_a_la_plage')
  })
  it('collapses and trims underscores', () =>
    expect(slugify('  --Sunset   Chapel-- ')).toBe('sunset_chapel'))
  it('falls back when nothing is left', () => expect(slugify('***')).toBe('painting'))
  it('caps the length at 24', () => expect(slugify('a'.repeat(40))).toHaveLength(24))
})

describe('makePaintingId', () => {
  it('adds a 3 character suffix', () => {
    expect(makePaintingId('Sunset', seq(0, 0.5, 0.999))).toMatch(/^sunset_[a-z0-9]{3}$/)
  })
  it('only produces valid characters', () => {
    expect(makePaintingId('Ça va? 🎨', Math.random)).toMatch(/^[a-z0-9_]+$/)
  })
})

describe('makeAssetId', () => {
  it('is 12 base36 chars', () => expect(makeAssetId(Math.random)).toMatch(/^[a-z0-9]{12}$/))
})

describe('namespaces', () => {
  it('accepts minecraft-style namespaces', () => {
    expect(isValidNamespace('ourpaintings')).toBe(true)
    expect(isValidNamespace('our.paintings-2')).toBe(true)
  })
  it('rejects bad ones', () => {
    for (const ns of ['', 'Our', 'a b', 'minecraft', 'x'.repeat(65), '.', '..', '.hidden', '-x'])
      expect(isValidNamespace(ns)).toBe(false)
  })
  it('derives from a name', () => expect(namespaceFromName('Our Paintings')).toBe('our_paintings'))
})
