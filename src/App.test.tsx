import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.tsx'
import { ShapeError } from './domain/errors.ts'
import type { Library } from './domain/types.ts'
import { createLibrary, createPainting, upsertPainting } from './domain/library.ts'
import * as decode from './imaging/decode.ts'
import { createRaster } from './imaging/raster.ts'
import { useEditor } from './state/editor.ts'
import { useLanguage } from './i18n/i18n.ts'
import { useNavigation } from './state/navigation.ts'
import { useWorkspace } from './state/workspace.ts'
import { memoryStorage } from './storage/persistence.ts'

const realInit = useWorkspace.getState().init
const realImportPack = useWorkspace.getState().importPack
const now = new Date('2026-10-15T12:00:00Z')

async function startWith(library: Library) {
  const storage = memoryStorage()
  await storage.save({ library, loose: [], assets: {} })
  await useWorkspace.getState().init(storage)
}

describe('App', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    useLanguage.setState({ language: 'en' })
    useNavigation.setState({ screen: { name: 'home' } })
    useWorkspace.setState({ ready: false, library: null, loose: [], assets: {} })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    useWorkspace.setState({ init: realInit })
  })

  it('shows a loading state, then the home screen once the workspace is ready', async () => {
    let finish: () => void = () => {}
    const init = () =>
      new Promise<void>((resolve) => {
        finish = () => {
          useWorkspace.setState({ ready: true })
          resolve()
        }
      })
    useWorkspace.setState({ init })
    render(<App />)
    expect(screen.getByText('Opening your workspace…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create a painting' })).not.toBeInTheDocument()
    finish()
    expect(await screen.findByRole('button', { name: 'Create a painting' })).toBeInTheDocument()
    expect(screen.getByText('Shape', { selector: 'header *' })).toBeInTheDocument()
  })

  it('explains when browser storage cannot be opened and lets the player go on', async () => {
    useWorkspace.setState({ init: () => Promise.reject(new Error('no IndexedDB')) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<App />)
    expect(
      await screen.findByRole('heading', { name: "Your browser storage couldn't be opened" }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Continue without saving' }))
    expect(useWorkspace.getState().ready).toBe(true)
    expect(screen.getByRole('button', { name: 'Create a painting' })).toBeInTheDocument()
  })

  it('routes to the export screen, which sends players without a library home', async () => {
    await useWorkspace.getState().init(memoryStorage())
    useNavigation.setState({ screen: { name: 'export' } })
    render(<App />)
    expect(await screen.findByText(/Exporting needs a library/)).toBeInTheDocument()
    expect(useNavigation.getState().screen).toEqual({ name: 'home' })
    expect(screen.getByRole('button', { name: 'Create a painting' })).toBeInTheDocument()
  })

  it('names the screen and the open painting in the tab title, in the language (M6)', async () => {
    const p = createPainting({ title: 'Rosace du soir', width: 1, height: 1 }, now, () => 0.5)
    await startWith(upsertPainting(createLibrary('Ours', 'ours'), p))
    useNavigation.setState({ screen: { name: 'library' } })
    render(<App />)
    expect(document.title).toBe('Library · Shape')
    act(() => useLanguage.getState().setLanguage('fr'))
    expect(document.title).toBe('Bibliothèque · Shape')
    act(() => useNavigation.getState().go({ name: 'editor', paintingId: p.id }))
    expect(document.title).toBe('Rosace du soir · Éditeur · Shape')
    act(() => useLanguage.getState().setLanguage('en'))
  })

  describe('files dropped anywhere (C4)', () => {
    function drop(file: File) {
      const event = createEvent.drop(document.body, {
        dataTransfer: { files: [file], types: ['Files'] },
      })
      fireEvent(document.body, event)
      return event
    }

    it('uses a picture dropped on another step as the picture, on the Image step', async () => {
      const p = createPainting({ title: 'Rose', width: 1, height: 1 }, now, () => 0.5)
      await startWith(upsertPainting(createLibrary('Ours', 'ours'), p))
      vi.spyOn(decode, 'fileToRaster').mockResolvedValue(createRaster(8, 8))
      useNavigation.setState({ screen: { name: 'editor', paintingId: p.id } })
      render(<App />)
      act(() => useEditor.getState().setStep('window'))
      const event = drop(new File(['x'], 'cat.png', { type: 'image/png' }))
      expect(event.defaultPrevented).toBe(true)
      expect(await screen.findByText(/Sized to/)).toBeInTheDocument()
      expect(useEditor.getState().step).toBe('image')
      expect(useEditor.getState().painting?.recipe.source).toMatchObject({ width: 8, height: 8 })

      // A second picture replaces the first and says so.
      drop(new File(['x'], 'dog.png', { type: 'image/png' }))
      expect(await screen.findByText('New picture: dog.png')).toBeInTheDocument()
    })

    it('imports a library pack dropped on the Library', async () => {
      await startWith(createLibrary('Ours', 'ours'))
      const importPack = vi.fn(() => ({
        kind: 'merged' as const,
        added: 2,
        kept: 0,
        sourceName: 'Ours',
        sourceNamespace: 'ours',
      }))
      useWorkspace.setState({ importPack })
      useNavigation.setState({ screen: { name: 'library' } })
      render(<App />)
      drop(new File(['zip'], 'ours-v3.zip', { type: '' }))
      expect(await screen.findByText('Added 2 paintings')).toBeInTheDocument()
      expect(importPack).toHaveBeenCalledTimes(1)
      useWorkspace.setState({ importPack: realImportPack })
    })

    it('starts a new painting with a picture dropped on the Library (R33)', async () => {
      await startWith(createLibrary('Ours', 'ours'))
      vi.spyOn(decode, 'fileToRaster').mockResolvedValue(createRaster(400, 300))
      useNavigation.setState({ screen: { name: 'library' } })
      render(<App />)
      const event = drop(new File(['x'], 'cat.png', { type: 'image/png' }))
      expect(event.defaultPrevented).toBe(true)
      // A draft (R18), sized to its picture (R20).
      expect(await screen.findByText('Sized to 4×3 blocks to fit your picture')).toBeInTheDocument()
      const { painting } = useEditor.getState()
      expect(painting?.recipe.source).toMatchObject({ width: 400, height: 300 })
      expect(useEditor.getState().step).toBe('image')
      // The picture is a change: autosave adds the draft to the library (R18, R19).
      await waitFor(() => expect(useWorkspace.getState().library?.paintings).toHaveLength(1))
    })

    it('explains a file the screen cannot use, and keeps the page', async () => {
      await startWith(createLibrary('Ours', 'ours'))
      useNavigation.setState({ screen: { name: 'library' } })
      render(<App />)
      const event = drop(new File(['x'], 'notes.txt', { type: 'text/plain' }))
      expect(event.defaultPrevented).toBe(true)
      expect(await screen.findByText(/Shape can't use this file/)).toBeInTheDocument()
    })

    it('stays on the step when a dropped picture cannot be read', async () => {
      const p = createPainting({ title: 'Rose', width: 1, height: 1 }, now, () => 0.5)
      await startWith(upsertPainting(createLibrary('Ours', 'ours'), p))
      vi.spyOn(decode, 'fileToRaster').mockRejectedValue(new ShapeError('not-an-image', 'bad'))
      useNavigation.setState({ screen: { name: 'editor', paintingId: p.id } })
      render(<App />)
      act(() => useEditor.getState().setStep('window'))
      drop(new File(['x'], 'broken.png', { type: 'image/png' }))
      expect(
        await screen.findByText("This file isn't an image Shape can read."),
      ).toBeInTheDocument()
      expect(useEditor.getState().step).toBe('window')
    })

    it('labels the overlay with what the drop will do', async () => {
      await startWith(createLibrary('Ours', 'ours'))
      useNavigation.setState({ screen: { name: 'library' } })
      render(<App />)
      fireEvent.dragEnter(document.body, { dataTransfer: { files: [], types: ['Files'] } })
      expect(screen.getByText('Drop to import the library pack')).toBeInTheDocument()
    })
  })
})
