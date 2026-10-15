import { describe, expect, it } from 'vitest'
import { createLibrary, createPainting, publish, upsertPainting } from '../../domain/library.ts'
import type { Library } from '../../domain/types.ts'
import { en } from '../../i18n/en.ts'
import { fr } from '../../i18n/fr.ts'
import { discordText, libraryDetail, pickMeta } from './exportText.ts'

const now = new Date('2026-10-15T12:00:00Z')

function library(...paintings: Array<[title: string, author: string]>): Library {
  let lib = createLibrary('Our paintings', 'ours')
  paintings.forEach(([title, author], i) => {
    const p = createPainting({ title, author, width: 2, height: 3 }, now, () => 0.1 * (i + 1))
    lib = upsertPainting(lib, p)
  })
  return lib
}

describe('export text', () => {
  it('writes the Discord post: the version, then one line per new painting', () => {
    const lib = library(['Sunset Chapel', 'Sam'], ['Night Rose', ''])
    const v1 = publish(
      lib,
      lib.paintings.map((p) => p.id),
      now,
    )
    expect(discordText(v1, 1, en)).toBe(
      '**Our paintings v1**\n- Sunset Chapel by Sam\n- Night Rose',
    )
    expect(discordText(v1, 1, fr)).toBe(
      '**Our paintings v1**\n- Sunset Chapel par Sam\n- Night Rose',
    )
  })

  it('says when a version adds nothing, and names untitled paintings', () => {
    const lib = library(['', 'Sam'])
    expect(discordText(lib, 2, en)).toBe(
      '**Our paintings v2**\n- No new paintings in this version.',
    )
    const v1 = publish(
      lib,
      lib.paintings.map((p) => p.id),
      now,
    )
    expect(discordText(v1, 1, en)).toBe('**Our paintings v1**\n- Untitled by Sam')
  })

  it('leaves the author out of a pick line when there is none (M8)', () => {
    const [withAuthor, without] = library(['A', 'Sam'], ['B', '']).paintings
    if (!withAuthor || !without) throw new Error('missing paintings')
    expect(pickMeta(withAuthor, en)).toBe('Sam · 2×3')
    expect(pickMeta(without, en)).toBe('2×3')
  })

  it('counts the library and its published paintings (M8)', () => {
    const lib = library(['A', 'Sam'], ['B', 'Sam'])
    const [a] = lib.paintings
    expect(libraryDetail(lib, en)).toBe('2 paintings')
    const one = publish(lib, a ? [a.id] : [], now)
    expect(libraryDetail(one, en)).toBe('2 paintings (1 published)')
    expect(libraryDetail(one, fr)).toBe('2 tableaux (1 publié)')
  })
})
