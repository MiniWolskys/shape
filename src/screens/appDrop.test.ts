import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en.ts'
import type { Screen } from '../state/navigation.ts'
import { fileKind, predictRoute, routeDrop, routeLabel } from './appDrop.ts'

const editor: Screen = { name: 'editor', paintingId: 'rose_abc' }
const draft: Screen = { name: 'editor', paintingId: null }
const home: Screen = { name: 'home' }
const library: Screen = { name: 'library' }
const exportScreen: Screen = { name: 'export' }

describe('fileKind', () => {
  it('tells pictures, zips and anything else apart by type or name', () => {
    expect(fileKind({ name: 'a.png', type: 'image/png' })).toBe('image')
    expect(fileKind({ name: 'photo.JPG', type: '' })).toBe('image')
    expect(fileKind({ name: 'pack-v2.zip', type: 'application/zip' })).toBe('zip')
    // Windows labels zips this way; some systems give no type at all.
    expect(fileKind({ name: 'pack', type: 'application/x-zip-compressed' })).toBe('zip')
    expect(fileKind({ name: 'PACK-V2.ZIP', type: '' })).toBe('zip')
    expect(fileKind({ name: 'notes.txt', type: 'text/plain' })).toBe('other')
  })
})

describe('routeDrop', () => {
  it('uses a picture in the editor, a draft included', () => {
    expect(routeDrop(editor, 'image')).toBe('picture')
    expect(routeDrop(draft, 'image')).toBe('picture')
  })

  it('imports a pack on Home and in the Library', () => {
    expect(routeDrop(home, 'zip')).toBe('pack')
    expect(routeDrop(library, 'zip')).toBe('pack')
  })

  it('starts a new painting with a picture dropped on Home or in the Library (R33)', () => {
    expect(routeDrop(home, 'image')).toBe('newPainting')
    expect(routeDrop(library, 'image')).toBe('newPainting')
  })

  it('explains everything else', () => {
    expect(routeDrop(editor, 'zip')).toBe('needsLibrary')
    expect(routeDrop(exportScreen, 'zip')).toBe('needsLibrary')
    expect(routeDrop(exportScreen, 'image')).toBe('needsPainting')
    for (const screen of [editor, home, library, exportScreen]) {
      expect(routeDrop(screen, 'other')).toBe('unsupported')
    }
  })
})

describe('predictRoute (while dragging, only types are known)', () => {
  it('expects what the screen takes when the type says nothing', () => {
    expect(predictRoute(editor, [''])).toBe('picture')
    expect(predictRoute(library, [])).toBe('pack')
    expect(predictRoute(exportScreen, [])).toBe('needsLibrary')
  })

  it('follows a known type', () => {
    expect(predictRoute(editor, ['image/png'])).toBe('picture')
    expect(predictRoute(editor, ['application/zip'])).toBe('needsLibrary')
    expect(predictRoute(library, ['application/x-zip-compressed'])).toBe('pack')
    expect(predictRoute(home, ['image/jpeg'])).toBe('newPainting')
    expect(predictRoute(library, ['text/plain'])).toBe('unsupported')
  })
})

describe('routeLabel', () => {
  it('says what a drop will do', () => {
    expect(routeLabel('picture', en)).toBe('Drop to use as the picture')
    expect(routeLabel('pack', en)).toBe('Drop to import the library pack')
    expect(routeLabel('newPainting', en)).toBe('Drop to start a painting with this picture')
    expect(routeLabel('needsPainting', en)).toBe(en.drop.needsPainting)
  })
})
