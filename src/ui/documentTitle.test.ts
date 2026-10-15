import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en.ts'
import { fr } from '../i18n/fr.ts'
import { documentTitle } from './documentTitle.ts'

describe('documentTitle', () => {
  it('names the screen, in the current language (M6)', () => {
    expect(documentTitle({ name: 'home' }, en, null)).toBe('Shape · Minecraft paintings')
    expect(documentTitle({ name: 'home' }, fr, null)).toBe('Shape · tableaux Minecraft')
    expect(documentTitle({ name: 'library' }, en, null)).toBe('Library · Shape')
    expect(documentTitle({ name: 'library' }, fr, null)).toBe('Bibliothèque · Shape')
    expect(documentTitle({ name: 'export' }, fr, null)).toBe('Exporter · Shape')
  })

  it('names the painting in the editor, or calls it untitled', () => {
    const editor = { name: 'editor', paintingId: 'rose_abc' } as const
    expect(documentTitle(editor, fr, 'Rosace du soir')).toBe('Rosace du soir · Éditeur · Shape')
    expect(documentTitle(editor, en, '')).toBe(`${en.library.untitled} · Editor · Shape`)
    // Before the painting is open there is no title yet.
    expect(documentTitle(editor, en, null)).toBe('Editor · Shape')
  })
})
