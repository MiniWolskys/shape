import { describe, expect, it } from 'vitest'
import { createLibrary, createPainting, publish, upsertPainting } from './library.ts'
import { validateForExport } from './validate.ts'
const now = new Date('2026-10-15T12:00:00Z')
const rnd = () => 0.42
describe('validateForExport', () => {
  const withSource = (title: string) => {
    const p = createPainting({ title, author: 'Sam' }, now, rnd)
    return { ...p, recipe: { ...p.recipe, source: { imageId: 'img1', width: 10, height: 10 } } }
  }
  it('blocks paintings without an image', () => {
    const p = createPainting({ title: 'A', author: 'S' }, now, rnd)
    const l = upsertPainting(createLibrary('L', 'l'), p)
    expect(validateForExport(l, [p.id], {})).toEqual([
      { code: 'no-image', paintingId: p.id, blocking: true },
    ])
  })
  it('blocks paintings whose image asset is missing', () => {
    const p = withSource('A')
    const l = upsertPainting(createLibrary('L', 'l'), p)
    expect(validateForExport(l, [p.id], {})).toEqual([
      { code: 'no-image', paintingId: p.id, blocking: true },
    ])
  })
  it('only warns about a missing title', () => {
    const p = withSource('')
    const l = upsertPainting(createLibrary('L', 'l'), p)
    expect(validateForExport(l, [p.id], { img1: new Uint8Array([1]) })).toEqual([
      { code: 'no-title', paintingId: p.id, blocking: false },
    ])
  })
  it('warns about a missing author', () => {
    const p = { ...withSource('A'), author: '' }
    const l = upsertPainting(createLibrary('L', 'l'), p)
    expect(validateForExport(l, [p.id], { img1: new Uint8Array([1]) })).toEqual([
      { code: 'no-author', paintingId: p.id, blocking: false },
    ])
  })
  it('reports a duplicated id once', () => {
    const p = withSource('A')
    const l = { ...createLibrary('L', 'l'), paintings: [p, { ...p }, { ...p }] }
    const issues = validateForExport(l, [p.id], { img1: new Uint8Array([1]) })
    expect(issues).toEqual([{ code: 'duplicate-id', paintingId: p.id, blocking: true }])
  })
  it('checks published paintings even when not listed', () => {
    const p = createPainting({ title: 'A', author: 'S' }, now, rnd)
    const l = publish(upsertPainting(createLibrary('L', 'l'), p), [p.id], now)
    expect(validateForExport(l, [], {}).map((i) => i.code)).toEqual(['no-image', 'nothing-new'])
  })
  it('warns when nothing new is selected', () => {
    expect(validateForExport(createLibrary('L', 'l'), [], {})).toEqual([
      { code: 'nothing-new', blocking: false },
    ])
  })
})
