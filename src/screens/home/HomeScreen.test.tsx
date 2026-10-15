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

  it('shows the wall showcase', () => {
    renderHome()
    expect(screen.getByRole('img', { name: /Gothic arch · 3×4 blocks/ })).toBeInTheDocument()
  })

  it('creates a loose painting and opens it in the editor', async () => {
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: 'Create a painting' }))
    const { loose } = useWorkspace.getState()
    expect(loose).toHaveLength(1)
    expect(useNavigation.getState().screen).toEqual({ name: 'editor', paintingId: loose[0]?.id })
  })

  it('shows a translated error when the dropped file is not a library pack', async () => {
    renderHome()
    dropFile(new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    expect(await screen.findByText("This file isn't a Shape library pack.")).toBeInTheDocument()
    expect(useNavigation.getState().screen).toEqual({ name: 'home' })
  })

  it('opens a dropped library pack and reports how many paintings were added', async () => {
    const bytes = await packBytes('ours', ['Sunset', 'Rose'])
    renderHome()
    dropFile(new File([bytes as Uint8Array<ArrayBuffer>], 'ours-v1.zip'))
    expect(await screen.findByText('Added 2 paintings')).toBeInTheDocument()
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
    expect(await screen.findByText('Added 1 painting')).toBeInTheDocument()
  })

  it('refuses a pack from another library while one is open', async () => {
    useWorkspace.getState().createLibrary('Mine', 'mine')
    const bytes = await packBytes('theirs', ['Sunset'])
    renderHome()
    dropFile(new File([bytes as Uint8Array<ArrayBuffer>], 'theirs-v1.zip'))
    expect(
      await screen.findByText("This pack doesn't belong to the open library (mine)."),
    ).toBeInTheDocument()
    expect(useWorkspace.getState().library?.namespace).toBe('mine')
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

  it('starts a new library with a namespace taken from its name', async () => {
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: 'Start a new library' }))
    const dialog = screen.getByRole('dialog', { name: 'Start a new library' })
    await userEvent.type(within(dialog).getByLabelText('Library name'), 'Our Paintings')
    const namespace = within(dialog).getByLabelText('Namespace')
    expect(namespace).toHaveValue('our_paintings')
    await userEvent.clear(namespace)
    await userEvent.type(namespace, 'Bad Name')
    expect(within(dialog).getByText(/Use only lowercase letters/)).toBeInTheDocument()
    const create = within(dialog).getByRole('button', { name: 'Create library' })
    expect(create).toBeDisabled()
    await userEvent.clear(namespace)
    await userEvent.type(namespace, 'ours')
    await userEvent.click(create)
    expect(useWorkspace.getState().library).toMatchObject({
      name: 'Our Paintings',
      namespace: 'ours',
    })
    expect(useNavigation.getState().screen).toEqual({ name: 'library' })
  })

  it('warns that starting a new library closes the open one', async () => {
    useWorkspace.getState().createLibrary('Old one', 'old')
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: 'Start a new library' }))
    const dialog = screen.getByRole('dialog', { name: 'Start a new library' })
    expect(within(dialog).getByText(/"Old one" will be closed/)).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('Library name'), 'New one')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close it and create' }))
    expect(useWorkspace.getState().library?.namespace).toBe('new_one')
  })

  it('opens the sample library', async () => {
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: 'Try the sample library' }))
    expect(useWorkspace.getState().library?.namespace).toBe('sample')
    expect(useWorkspace.getState().library?.paintings).toHaveLength(4)
    expect(useNavigation.getState().screen).toEqual({ name: 'library' })
  })

  it('speaks French', () => {
    renderHome()
    act(() => useLanguage.setState({ language: 'fr' }))
    const heading = screen.getByRole('heading', { level: 1 })
    expect(within(heading).getByText('Façonnez').tagName).toBe('EM')
    expect(heading).toHaveTextContent(
      "Façonnez n'importe quelle image en un tableau que l'on peut traverser du regard.",
    )
    expect(screen.getByRole('button', { name: 'Créer un tableau' })).toBeInTheDocument()
  })
})
