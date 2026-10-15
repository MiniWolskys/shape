import { describe, expect, it } from 'vitest'
import {
  addLoosePaintings,
  canDelete,
  canResize,
  createLibrary,
  createPainting,
  defaultRecipe,
  copyAsNew,
  exportSet,
  insertAfter,
  isChanged,
  mergeLibraries,
  paintingState,
  readyToExport,
  publish,
  removePainting,
  retitlePainting,
  unexportedPaintings,
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
      status: 'ready',
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
    expect(out.paintings[1]!.status).toBe('ready')
    expect(whatsNew(out, 1).map((p) => p.id)).toEqual([a!.id])
    expect(l.version).toBe(0)
    expect(l.paintings[0]!.status).toBe('ready')
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
  it('merge keeps the local export time, taking the incoming one only when there is none', () => {
    // A later incoming time could hide local changes made after the local export (R15).
    const early = { ...lib('A'), exportedAt: '2026-10-01T00:00:00.000Z' }
    const late = { ...early, exportedAt: '2026-10-09T00:00:00.000Z' }
    const { exportedAt: _, ...never } = early
    expect(mergeLibraries(early, late).library.exportedAt).toBe(early.exportedAt)
    expect(mergeLibraries(never, late).library.exportedAt).toBe(late.exportedAt)
    expect(mergeLibraries(never, never).library.exportedAt).toBeUndefined()
  })
  it('merge keeps no export time when the local library has published paintings but none', () => {
    const l = lib('A')
    const { exportedAt: _, ...published } = {
      ...publish(l, [l.paintings[0]!.id], now),
      exportedAt: 'x',
    }
    const incoming = { ...lib('B'), exportedAt: '2026-10-09T00:00:00.000Z' }
    expect(mergeLibraries(published, incoming).library.exportedAt).toBeUndefined()
  })
  it('merge never adopts an export time from the future (clock skew)', () => {
    const { exportedAt: _, ...never } = lib('A')
    const ahead = { ...lib('B'), exportedAt: '2027-01-01T00:00:00.000Z' }
    expect(mergeLibraries(never, ahead, now).library.exportedAt).toBe(now.toISOString())
  })
  it('merge knows a renamed draft by its former id, in either direction (I4)', () => {
    const base = lib('A')
    const draft = base.paintings[0]!
    const renamed = retitlePainting(draft, 'Rose', new Set(), now, rnd)
    expect(renamed.formerIds).toEqual([draft.id])
    const mine = { ...base, paintings: [renamed] }
    // An older pack still names it by its old id: no ghost copy comes back.
    const older = mergeLibraries(mine, base)
    expect(older.added).toEqual([])
    expect(older.library.paintings.map((p) => p.id)).toEqual([renamed.id])
    expect(older.kept).toEqual([renamed])
    // A friend renamed their copy: still the same painting.
    const fromFriend = mergeLibraries(base, mine)
    expect(fromFriend.added).toEqual([])
    expect(fromFriend.library.paintings.map((p) => p.id)).toEqual([draft.id])
  })
  it('merge takes a published copy of a renamed draft in its place', () => {
    const base = lib('A')
    const draft = base.paintings[0]!
    const renamed = retitlePainting(draft, 'Rose', new Set(), now, rnd)
    const theirs = publish({ ...base, paintings: [renamed] }, [renamed.id], now)
    const { library, added } = mergeLibraries(base, theirs)
    expect(added).toEqual([])
    expect(library.paintings).toEqual(theirs.paintings)
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

describe('export state (R15, R16)', () => {
  const later = new Date('2026-10-16T12:00:00Z')
  const exported = (l: ReturnType<typeof lib>, ids: string[]) => ({
    ...publish(l, ids, now),
    exportedAt: now.toISOString(),
  })

  it('counts every painting as unexported while the library was never exported', () => {
    const l = publish(lib('A', 'B'), [], now)
    expect(unexportedPaintings(l).map((p) => p.title)).toEqual(['A', 'B'])
    expect(unexportedPaintings(createLibrary('L', 'l'))).toEqual([])
  })
  it('after an export, counts unpublished and changed paintings only', () => {
    const l = exported(lib('A', 'B', 'C'), [])
    const [a, b] = l.paintings
    const pub = exported(l, [a!.id, b!.id])
    const changed = {
      ...pub,
      paintings: pub.paintings.map((p) =>
        p.id === b!.id ? updatePainting(p, { title: 'B2' }, later) : p,
      ),
    }
    expect(unexportedPaintings(pub).map((p) => p.title)).toEqual(['C'])
    expect(unexportedPaintings(changed).map((p) => p.title)).toEqual(['B2', 'C'])
  })
  it('isChanged: published and updated after the last export', () => {
    const l = exported(lib('A', 'B'), [])
    const pub = exported(l, [l.paintings[0]!.id])
    const [a, b] = pub.paintings
    expect(isChanged(a!, pub)).toBe(false)
    expect(isChanged(b!, pub)).toBe(false)
    expect(isChanged(updatePainting(a!, { title: 'A2' }, later), pub)).toBe(true)
    expect(isChanged(updatePainting(b!, { title: 'B2' }, later), pub)).toBe(false)
    const { exportedAt: _, ...neverExported } = pub
    expect(isChanged(updatePainting(a!, { title: 'A2' }, later), neverExported)).toBe(false)
  })
})

describe('retitlePainting (R17)', () => {
  const later = new Date('2026-10-16T12:00:00Z')
  const fixed = (id: string) => ({ ...createPainting({ title: '' }, now, rnd), id })

  it('makes the id follow the title and keeps the suffix while unpublished', () => {
    const p = retitlePainting(fixed('painting_3js'), 'Rosace du soir', new Set(), later, rnd)
    expect(p).toMatchObject({ id: 'rosace_du_soir_3js', title: 'Rosace du soir' })
    expect(p.updatedAt).toBe(later.toISOString())
  })
  it('falls back to "painting" for an empty title', () => {
    expect(retitlePainting(fixed('rose_3js'), '  ', new Set(), later, rnd).id).toBe('painting_3js')
  })
  it('remembers former ids, newest last, and drops them from copies', () => {
    const a = retitlePainting(fixed('painting_3js'), 'Rose', new Set(), later, rnd)
    const b = retitlePainting(a, 'Lily', new Set(), later, rnd)
    expect(b.formerIds).toEqual(['painting_3js', 'rose_3js'])
    const back = retitlePainting(b, 'Rose', new Set(), later, rnd)
    expect(back.formerIds).toEqual(['painting_3js', 'lily_3js'])
    const copy = copyAsNew(b, {
      title: 'Copy',
      takenIds: new Set(),
      takenAssetIds: new Set(),
      now,
      random: rnd,
    })
    expect(copy.painting.formerIds).toBeUndefined()
  })
  it('picks a new suffix when the id is taken by another painting', () => {
    const p = retitlePainting(fixed('painting_3js'), 'Rose', new Set(['rose_3js']), later, rnd)
    expect(p.id).toMatch(/^rose_[a-z0-9]{3}$/)
    expect(p.id).not.toBe('rose_3js')
  })
  it('keeps the id when the title gives the same slug', () => {
    const p = retitlePainting(fixed('rose_3js'), 'Rose', new Set(['rose_3js']), later, rnd)
    expect(p.id).toBe('rose_3js')
  })
  it('gives an id without a suffix a fresh one', () => {
    expect(retitlePainting(fixed('sunset'), 'Moon', new Set(), later, rnd).id).toMatch(
      /^moon_[a-z0-9]{3}$/,
    )
  })
  it('only keeps a three-character suffix', () => {
    const p = retitlePainting(fixed('sunset_aaa0'), 'Moon', new Set(), later, rnd)
    expect(p.id).toMatch(/^moon_[a-z0-9]{3}$/)
  })
  it('avoids a collision between long titles that share their first 24 characters', () => {
    const taken = 'the_great_window_of_the_3js'
    const p = retitlePainting(
      fixed('painting_3js'),
      'The great window of the south',
      new Set([taken]),
      later,
      rnd,
    )
    expect(p.id).toMatch(/^the_great_window_of_the_[a-z0-9]{3}$/)
    expect(p.id).not.toBe(taken)
  })
  it('never changes a published id', () => {
    const l = lib('A')
    const pub = publish(l, [l.paintings[0]!.id], now).paintings[0]!
    const p = retitlePainting(pub, 'Renamed', new Set(), later, rnd)
    expect(p).toMatchObject({ id: pub.id, title: 'Renamed' })
  })
})

describe('copies', () => {
  it('insertAfter puts a painting right after another one, or at the end', () => {
    const [a, b] = lib('A', 'B').paintings
    const c = createPainting({ title: 'C' }, now, rnd)
    expect(insertAfter([a!, b!], a!.id, c).map((p) => p.title)).toEqual(['A', 'C', 'B'])
    expect(insertAfter([a!, b!], 'missing', c).map((p) => p.title)).toEqual(['A', 'B', 'C'])
  })
  it('copyAsNew gives a fresh unpublished ready painting with fresh asset ids', () => {
    const l = lib('Sunset')
    const p0 = publish(l, [l.paintings[0]!.id], now).paintings[0]!
    const p = {
      ...p0,
      recipe: { ...p0.recipe, source: { imageId: 'img', width: 1, height: 1 }, editsId: 'ed' },
    }
    const later = new Date('2026-10-16T12:00:00Z')
    const out = copyAsNew(p, {
      title: 'Sunset (copy)',
      takenIds: new Set([p.id]),
      takenAssetIds: new Set(['img', 'ed']),
      now: later,
      random: rnd,
    })
    expect(out.painting).toMatchObject({ title: 'Sunset (copy)', status: 'ready' })
    expect(out.painting.id).toMatch(/^sunset_copy_[a-z0-9]{3}$/)
    expect(out.painting.publishedIn).toBeUndefined()
    expect(out.painting.createdAt).toBe(later.toISOString())
    expect(out.painting.updatedAt).toBe(later.toISOString())
    const image = out.painting.recipe.source?.imageId ?? ''
    const edits = out.painting.recipe.editsId ?? ''
    expect(image).not.toBe('img')
    expect(edits).not.toBe('ed')
    expect(out.assetIds).toEqual({ img: image, ed: edits, 'ed.mask': `${edits}.mask` })
    expect(p.recipe.source?.imageId).toBe('img')
  })

  it('paintingState: draft, ready, published, or changed since the last export (R16)', () => {
    const base = lib('A', 'B', 'C')
    const [a, b, c] = base.paintings
    if (!a || !b || !c) throw new Error('missing paintings')
    const later = '2026-10-15T13:00:00.000Z'
    const exported: typeof base = {
      ...base,
      exportedAt: '2026-10-15T12:30:00.000Z',
      paintings: [
        { ...a, status: 'draft' },
        { ...b, status: 'published', publishedIn: 1 },
        { ...c, status: 'published', publishedIn: 1, updatedAt: later },
      ],
    }
    expect(exported.paintings.map((p) => paintingState(p, exported))).toEqual([
      'draft',
      'published',
      'changed',
    ])
    expect(paintingState(a, null)).toBe('ready')
  })

  it('readyToExport: ready paintings that have a picture, as Export ticks them', () => {
    const base = lib('A', 'B', 'C')
    const [a, b, c] = base.paintings
    if (!a || !b || !c) throw new Error('missing paintings')
    const source = { imageId: 'img', width: 1, height: 1 }
    const l = {
      ...base,
      paintings: [
        { ...a, recipe: { ...a.recipe, source } },
        b,
        { ...c, status: 'draft' as const, recipe: { ...c.recipe, source } },
      ],
    }
    expect(readyToExport(l).map((p) => p.title)).toEqual(['A'])
  })
})
