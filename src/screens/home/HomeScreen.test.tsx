import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLibrary, createPainting, upsertPainting } from '../../domain/library.ts'
import type { Workspace } from '../../domain/types.ts'
import { useLanguage } from '../../i18n/i18n.ts'
import { createRaster } from '../../imaging/raster.ts'
import { writeLibraryPack } from '../../packs/libraryPack.ts'
import { encodePng } from '../../packs/png.ts'
import { useNavigation } from '../../state/navigation.ts'
import { useWorkspace } from '../../state/workspace.ts'
import { memoryStorage } from '../../storage/persistence.ts'
import { Toasts } from '../../ui/Toasts.tsx'
import { useToasts } from '../../ui/toastStore.ts'
import { AppFileDrop } from '../AppFileDrop.tsx'
import { HomeScreen } from './HomeScreen.tsx'

const now = new Date('2026-10-15T12:00:00Z')

async function startWith(saved: Workspace | null = null) {
  const storage = memoryStorage()
  if (saved) await storage.save(saved)
  await useWorkspace.getState().init(storage)
}

function renderHome() {
  return render(
    <>
      <HomeScreen />
      <AppFileDrop />
      <Toasts />
    </>,
  )
}

async function packBytes(namespace: string, titles: string[]): Promise<Uint8Array> {
  let lib = createLibrary('Pack', namespace)
  const assets: Record<string, Uint8Array> = {}
  titles.forEach((title, i) => {
    const p0 = createPainting({ title, width: 1, height: 1, pixelsPerBlock: 16 }, now, () => 0.3)
    const imageId = `img${i}`
    const p = {
      ...p0,
      id: `${p0.id}${i}`,
      recipe: { ...p0.recipe, source: { imageId, width: 4, height: 4 } },
    }
    assets[imageId] = encodePng(createRaster(4, 4, [0, 255, 0, 255]))
    lib = upsertPainting(lib, p)
  })
  const out = await writeLibraryPack(
    lib,
    lib.paintings.map((p) => p.id),
    assets,
    now,
  )
  return out.bytes
}

function dropFile(file: File) {
  fireEvent.drop(screen.getByRole('heading', { level: 1 }), {
    dataTransfer: { files: [file], types: ['Files'] },
  })
}

describe('HomeScreen', () => {
  beforeEach(async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    useLanguage.setState({ language: 'en' })
    useNavigation.setState({ screen: { name: 'home' } })
    useToasts.setState({ toasts: [] })
    await startWith()
  })
  afterEach(() => vi.restoreAllMocks())

  it('renders the headline with "Shape" emphasised', () => {
    renderHome()
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('Shape any picture into a painting you can see through.')
    expect(within(heading).getByText('Shape').tagName).toBe('EM')
  })

  it('explains how it works in three steps, the library pack and the mod (I12, I20)', () => {
    renderHome()
    const how = screen.getByRole('region', { name: 'How it works' })
    expect(
      within(how)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Make a painting', 'Collect them in a library', 'Export one file for your server'])
    expect(how).toHaveTextContent('A library pack is the .zip Shape exports')
    expect(how).toHaveTextContent('Transparent Paintings mod')
  })

  it('names the file to drop only once one was exported (I19)', async () => {
    renderHome()
    expect(screen.getByText('a library pack .zip')).toBeInTheDocument()
    act(() => useWorkspace.getState().createLibrary('Ours', 'ours'))
    expect(screen.getByText('a library pack .zip')).toBeInTheDocument()
    act(() =>
      useWorkspace.setState((s) => ({ library: s.library && { ...s.library, version: 3 } })),
    )
    expect(screen.getByText('ours-v3.zip')).toBeInTheDocument()
  })

  it('says where a new painting goes when a library is open (I19)', () => {
    renderHome()
    expect(screen.getByText('No library needed. Add it to one later.')).toBeInTheDocument()
    act(() => useWorkspace.getState().createLibrary('Ours', 'ours'))
    expect(screen.getByText('Goes into Ours.')).toBeInTheDocument()
  })

  it('shows the wall showcase', () => {
    renderHome()
    expect(screen.getByRole('img', { name: /Gothic arch · 3×4 blocks/ })).toBeInTheDocument()
  })

  it('opens a new painting in the editor without adding it yet (R18)', async () => {
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: 'Create a painting' }))
    expect(useWorkspace.getState().loose).toHaveLength(0)
    expect(useNavigation.getState().screen).toEqual({ name: 'editor', paintingId: null })
  })

  it('shows a translated error when the dropped zip is not a library pack', async () => {
    renderHome()
    dropFile(new File(['hello'], 'photos.zip', { type: 'application/zip' }))
    expect(await screen.findByText("This file isn't a Shape library pack.")).toBeInTheDocument()
    expect(useNavigation.getState().screen).toEqual({ name: 'home' })
  })

  it('explains that other files are not taken here (C4)', async () => {
    renderHome()
    dropFile(new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    expect(await screen.findByText(/Shape can't use this file/)).toBeInTheDocument()
    expect(useNavigation.getState().screen).toEqual({ name: 'home' })
  })

  it('opens a dropped library pack and reports how many paintings were added', async () => {
    const bytes = await packBytes('ours', ['Sunset', 'Rose'])
    renderHome()
    dropFile(new File([bytes as Uint8Array<ArrayBuffer>], 'ours-v1.zip'))
    expect(await screen.findByText('Opened Pack · 2 paintings')).toBeInTheDocument()
    expect(useWorkspace.getState().library?.namespace).toBe('ours')
    expect(useNavigation.getState().screen).toEqual({ name: 'library' })
  })

  it('opens a pack chosen with the browse button', async () => {
    const bytes = await packBytes('ours', ['Sunset'])
    const { container } = renderHome()
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    if (!input) return
    await userEvent.upload(input, new File([bytes as Uint8Array<ArrayBuffer>], 'ours-v1.zip'))
    expect(await screen.findByText('Opened Pack · 1 painting')).toBeInTheDocument()
  })

  it('asks before adding the paintings of another library to the open one (R21)', async () => {
    useWorkspace.getState().createLibrary('Mine', 'mine')
    const bytes = await packBytes('theirs', ['Sunset'])
    renderHome()
    dropFile(new File([bytes as Uint8Array<ArrayBuffer>], 'theirs-v1.zip'))
    const dialog = await screen.findByRole('dialog', {
      name: 'Add 1 painting from “Pack” to Mine?',
    })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add 1 painting' }))
    expect(await screen.findByText('Added 1 painting from Pack')).toBeInTheDocument()
    expect(useWorkspace.getState().library?.namespace).toBe('mine')
    expect(useWorkspace.getState().library?.paintings.map((p) => p.title)).toEqual(['Sunset'])
  })

  it('adds nothing when the player cancels the import', async () => {
    useWorkspace.getState().createLibrary('Mine', 'mine')
    const bytes = await packBytes('theirs', ['Sunset', 'Rose'])
    renderHome()
    dropFile(new File([bytes as Uint8Array<ArrayBuffer>], 'theirs-v1.zip'))
    const dialog = await screen.findByRole('dialog', {
      name: 'Add 2 paintings from “Pack” to Mine?',
    })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await act(async () => {})
    expect(useWorkspace.getState().library?.paintings).toEqual([])
    expect(useNavigation.getState().screen).toEqual({ name: 'home' })
  })

  it('asks before a pack replaces a demo the player changed (R25)', async () => {
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: 'Try the sample library' }))
    const [first] = useWorkspace.getState().library?.paintings ?? []
    if (first) act(() => useWorkspace.getState().retitlePainting(first.id, 'Mine now'))
    const bytes = await packBytes('ours', ['Sunset'])
    dropFile(new File([bytes as Uint8Array<ArrayBuffer>], 'ours-v1.zip'))
    const dialog = await screen.findByRole('dialog', { name: 'Close Sample paintings?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete 1 and close' }))
    expect(await screen.findByText('Opened Pack · 1 painting')).toBeInTheDocument()
    expect(useWorkspace.getState().library?.namespace).toBe('ours')
    expect(useWorkspace.getState().demo).toBe(false)
  })

  it('hides Resume when there is no saved work', () => {
    renderHome()
    expect(screen.queryByText('Resume where you left off')).not.toBeInTheDocument()
  })

  it('offers Resume with the saved library and goes to it', async () => {
    let library = createLibrary('Our paintings', 'ours')
    library = { ...library, version: 7 }
    library = upsertPainting(
      library,
      createPainting({ title: 'A' }, now, () => 0.1),
    )
    library = upsertPainting(library, {
      ...createPainting({ title: 'B' }, now, () => 0.2),
      status: 'published',
    })
    const loose = [createPainting({ title: 'C' }, now, () => 0.3)]
    await startWith({ library, loose, assets: {} })
    renderHome()
    expect(screen.getByText('Resume where you left off')).toBeInTheDocument()
    expect(screen.getByText(/Our paintings v7 · 2 paintings in progress/)).toBeInTheDocument()
    // Returning players find it first (I19).
    const resumeButton = screen.getByRole('button', { name: /Resume where you left off/ })
    const create = screen.getByRole('button', { name: 'Create a painting' })
    expect(resumeButton.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    await userEvent.click(screen.getByRole('button', { name: /Resume where you left off/ }))
    expect(useNavigation.getState().screen).toEqual({ name: 'library' })
  })

  it('hides Resume once the saved library is closed and nothing is left', async () => {
    await startWith({ library: createLibrary('Ours', 'ours'), loose: [], assets: {} })
    renderHome()
    expect(screen.getByText('Resume where you left off')).toBeInTheDocument()
    act(() => useWorkspace.getState().closeLibrary())
    expect(screen.queryByText('Resume where you left off')).not.toBeInTheDocument()
  })

  it('says when the latest painting was saved (I19)', async () => {
    const minutesAgo = new Date(Date.now() - 5 * 60_000).toISOString()
    const p = { ...createPainting({ title: 'Solo' }, now, () => 0.4), updatedAt: minutesAgo }
    await startWith({ library: null, loose: [p], assets: {} })
    renderHome()
    expect(screen.getByText(/saved 5 minutes ago/)).toBeInTheDocument()
    act(() => useLanguage.setState({ language: 'fr' }))
    expect(screen.getByText(/enregistré il y a 5 minutes/)).toBeInTheDocument()
  })

  it('offers Resume for work started in this visit', () => {
    act(() => {
      useWorkspace.getState().createPainting()
    })
    renderHome()
    expect(screen.getByText('Resume where you left off')).toBeInTheDocument()
  })

  it('resumes the single loose painting in the editor when there is no library', async () => {
    const p = createPainting({ title: 'Solo' }, now, () => 0.4)
    await startWith({ library: null, loose: [p], assets: {} })
    renderHome()
    expect(screen.getByText(/1 painting in progress/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Resume where you left off/ }))
    expect(useNavigation.getState().screen).toEqual({ name: 'editor', paintingId: p.id })
  })

  it('starts a new library from its name alone, the pack ID under Advanced (R22)', async () => {
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: 'Start a new library' }))
    const dialog = screen.getByRole('dialog', { name: 'Start a new library' })
    await userEvent.type(within(dialog).getByLabelText('Library name'), 'Our Paintings')
    const advanced = within(dialog).getByText('Advanced')
    expect(advanced.closest('details')).not.toHaveAttribute('open')
    await userEvent.click(advanced)
    expect(within(dialog).getByText(/can't change after the first export/)).toBeInTheDocument()
    const packId = within(dialog).getByLabelText('Pack ID')
    expect(packId).toHaveValue('our_paintings')
    await userEvent.clear(packId)
    await userEvent.type(packId, 'Bad Name')
    expect(within(dialog).getByText(/Use only lowercase letters/)).toBeInTheDocument()
    const create = within(dialog).getByRole('button', { name: 'Create library' })
    expect(create).toBeDisabled()
    await userEvent.clear(packId)
    await userEvent.type(packId, 'ours')
    await userEvent.click(create)
    expect(useWorkspace.getState().library).toMatchObject({
      name: 'Our Paintings',
      namespace: 'ours',
    })
    expect(useNavigation.getState().screen).toEqual({ name: 'library' })
  })

  it('names what a new library would delete before replacing the open one (R15)', async () => {
    useWorkspace.getState().createLibrary('Old one', 'old')
    act(() => {
      useWorkspace.getState().createPainting()
    })
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: 'Start a new library' }))
    const dialog = screen.getByRole('dialog', { name: 'Start a new library' })
    expect(dialog).toHaveTextContent('This closes Old one.')
    await userEvent.type(within(dialog).getByLabelText('Library name'), 'New one')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create library' }))
    const confirm = screen.getByRole('dialog', { name: 'Close Old one?' })
    expect(confirm).toHaveTextContent("1 painting hasn't been exported yet")
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete 1 and close' }))
    expect(useWorkspace.getState().library?.namespace).toBe('new_one')
    expect(useWorkspace.getState().library?.paintings).toEqual([])
  })

  it('keeps the open library when the player picks Export first', async () => {
    useWorkspace.getState().createLibrary('Old one', 'old')
    act(() => {
      useWorkspace.getState().createPainting()
    })
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: 'Try the sample library' }))
    const confirm = screen.getByRole('dialog', { name: 'Close Old one?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Export first' }))
    expect(useNavigation.getState().screen).toEqual({ name: 'export' })
    expect(useWorkspace.getState().library?.namespace).toBe('old')
    expect(useWorkspace.getState().demo).toBe(false)
  })

  it('replaces an empty library with the sample after a plain confirm', async () => {
    useWorkspace.getState().createLibrary('Old one', 'old')
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: 'Try the sample library' }))
    const confirm = screen.getByRole('dialog', { name: 'Close Old one?' })
    expect(confirm).toHaveTextContent('Old one has no paintings')
    await userEvent.click(
      within(confirm).getByRole('button', { name: 'Close it and open the demo' }),
    )
    expect(useWorkspace.getState().demo).toBe(true)
    expect(useNavigation.getState().screen).toEqual({ name: 'library' })
  })

  it('opens the sample library', async () => {
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: 'Try the sample library' }))
    expect(useWorkspace.getState().library?.namespace).toBe('sample')
    expect(useWorkspace.getState().library?.paintings).toHaveLength(4)
    expect(useWorkspace.getState().demo).toBe(true)
    expect(useNavigation.getState().screen).toEqual({ name: 'library' })
  })

  it('titles the sample paintings in the current language', async () => {
    renderHome()
    act(() => useLanguage.setState({ language: 'fr' }))
    await userEvent.click(screen.getByRole('button', { name: 'Essayer la démo' }))
    expect(useWorkspace.getState().library?.paintings.map((p) => p.title)).toEqual([
      'Chapelle au couchant',
      'Rosace de nuit',
      'Fenêtre de printemps',
      'Oculus de givre',
    ])
  })

  it('speaks French', () => {
    renderHome()
    act(() => useLanguage.setState({ language: 'fr' }))
    const heading = screen.getByRole('heading', { level: 1 })
    expect(within(heading).getByText('Façonnez').tagName).toBe('EM')
    expect(heading).toHaveTextContent('Façonnez vos images en tableaux-fenêtres.')
    expect(screen.getByRole('button', { name: 'Créer un tableau' })).toBeInTheDocument()
  })
})
