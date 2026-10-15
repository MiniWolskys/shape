import { describe, expect, it } from 'vitest'
import {
  addLoosePaintings,
  canDelete,
  canResize,
  createLibrary,
  createPainting,
  defaultRecipe,
  exportSet,
  mergeLibraries,
  publish,
  removePainting,
  updatePainting,
  upsertPainting,
  whatsNew,
} from './library.ts'
import { ShapeError } from './errors.ts'

const now = new Date('2026-10-15T12:00:00Z')
let n = 0
const rnd = () => (n++ * 0.137) % 1
const lib = (...titles: string[]) =>
  titles.reduce(
    (l, t) => upsertPainting(l, createPainting({ title: t }, now, rnd)),
    createLibrary('Our paintings', 'ourpaintings'),
  )

describe('library', () => {
  it('creates paintings with defaults', () => {
    const p = createPainting({ title: 'Sunset' }, now, rnd)
    expect(p).toMatchObject({
      width: 1,
      height: 1,
      pixelsPerBlock: 32,
      status: 'draft',
      titleColor: 'yellow',
      authorColor: 'gray',
    })
    expect(p.id).toMatch(/^sunset_/)
    expect(p.recipe).toEqual(defaultRecipe())
  })
  it('creates an empty library at version 0', () => {
    expect(createLibrary('L', 'l')).toEqual({
      formatVersion: 1,
      name: 'L',
      namespace: 'l',
      version: 0,
      paintings: [],
    })
  })
  it('publish bumps the version and locks chosen paintings', () => {
    const l = lib('A', 'B')
    const [a] = l.paintings
    const out = publish(l, [a!.id], now)
    expect(out.version).toBe(1)
    expect(out.paintings[0]).toMatchObject({ status: 'published', publishedIn: 1 })
    expect(out.paintings[1]!.status).toBe('draft')
    expect(whatsNew(out, 1).map((p) => p.id)).toEqual([a!.id])
    expect(l.version).toBe(0)
    expect(l.paintings[0]!.status).toBe('draft')
  })
  it('publish with no ids still bumps the version and keeps updatedAt', () => {
    const l = lib('A')
    const out = publish(l, [], new Date('2027-01-01T00:00:00Z'))
    expect(out.version).toBe(1)
    expect(out.paintings[0]).toEqual(l.paintings[0])
  })
  it('export set always includes published paintings', () => {
    const l = publish(lib('A', 'B', 'C'), [], now)
    const pub = publish(l, [l.paintings[0]!.id], now)
    expect(exportSet(pub, [pub.paintings[2]!.id]).map((p) => p.title)).toEqual(['A', 'C'])
  })
  it('refuses to delete or resize a published painting', () => {
    const l = lib('A')
    const id = l.paintings[0]!.id
    const pub = publish(l, [id], now)
    expect(() => removePainting(pub, id)).toThrow(ShapeError)
    expect(() => updatePainting(pub.paintings[0]!, { width: 2 }, now)).toThrow(ShapeError)
    expect(updatePainting(pub.paintings[0]!, { title: 'New' }, now).title).toBe('New')
    expect(canDelete(pub.paintings[0]!)).toBe(false)
    expect(canResize(pub.paintings[0]!)).toBe(false)
    expect(canDelete(l.paintings[0]!)).toBe(true)
    expect(removePainting(l, id).paintings).toHaveLength(0)
  })
  it('merge only adds, and prefers published copies', () => {
    const base = lib('A')
    const mine = upsertPainting(base, createPainting({ title: 'Mine' }, now, rnd))
    const theirs = publish(
      upsertPainting(base, createPainting({ title: 'Theirs' }, now, rnd)),
      [base.paintings[0]!.id],
      now,
    )
    const { library, added } = mergeLibraries(mine, theirs)
    expect(added.map((p) => p.title)).toEqual(['Theirs'])
    expect(library.paintings.map((p) => p.title)).toEqual(['A', 'Mine', 'Theirs'])
    expect(library.paintings.find((p) => p.title === 'A')!.status).toBe('published')
    expect(library.version).toBe(1)
    expect(library.name).toBe('Our paintings')
  })
  it('merge refuses another namespace', () => {
    expect(() => mergeLibraries(lib('A'), createLibrary('Other', 'other'))).toThrow(/namespace/)
  })
  it('a published painting missing from an older pack is kept', () => {
    const l = lib('A')
    const pub = publish(l, [l.paintings[0]!.id], now)
    expect(
      mergeLibraries(pub, createLibrary('Our paintings', 'ourpaintings')).library.paintings,
    ).toHaveLength(1)
  })
  it('keeps the local copy when it is already published', () => {
    const l = lib('A')
    const pub = publish(l, [l.paintings[0]!.id], now)
    const other = { ...pub, paintings: [{ ...pub.paintings[0]!, title: 'Changed' }] }
    const { library, kept } = mergeLibraries(pub, other)
    expect(library.paintings[0]!.title).toBe('A')
    expect(kept.map((p) => p.id)).toEqual([pub.paintings[0]!.id])
  })
  it('re-ids colliding loose paintings', () => {
    const l = lib('A')
    const loose = { ...createPainting({ title: 'B' }, now, rnd), id: l.paintings[0]!.id }
    const out = addLoosePaintings(l, [loose], rnd)
    expect(new Set(out.paintings.map((p) => p.id)).size).toBe(2)
  })
  it('re-ids loose paintings that collide with each other', () => {
    const a = { ...createPainting({ title: 'B' }, now, rnd), id: 'b_aaa' }
    const b = { ...createPainting({ title: 'B' }, now, rnd), id: 'b_aaa' }
    const out = addLoosePaintings(createLibrary('L', 'l'), [a, b], rnd)
    expect(new Set(out.paintings.map((p) => p.id)).size).toBe(2)
    expect(out.paintings[0]!.id).toBe('b_aaa')
  })
})
