import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLibrary, createPainting, upsertPainting } from '../../domain/library.ts'
import type { Library, Painting, PaintingStatus, Workspace } from '../../domain/types.ts'
import { useLanguage } from '../../i18n/i18n.ts'
import { writeLibraryPack } from '../../packs/libraryPack.ts'
import { useNavigation } from '../../state/navigation.ts'
import { useWorkspace } from '../../state/workspace.ts'
import { memoryStorage } from '../../storage/persistence.ts'
import { Toasts } from '../../ui/Toasts.tsx'
import { useToasts } from '../../ui/toastStore.ts'
import { LibraryScreen } from './LibraryScreen.tsx'

// Thumbnails render on idle callbacks; their own tests cover them.
vi.mock('../../state/thumbnails.ts', () => ({ useThumbnail: () => null }))

const now = new Date('2026-10-15T12:00:00Z')
let seed = 0

function painting(title: string, author: string, status: PaintingStatus = 'ready'): Painting {
  seed += 1
  const p = createPainting({ title, author, width: 2, height: 3 }, now, () => 0.5)
  return { ...p, id: `${p.id}_${seed}`, status }
}

function library(paintings: Painting[], name = 'Our paintings'): Library {
  let lib = { ...createLibrary(name, 'ours'), version: 7 }
  for (const p of paintings) lib = upsertPainting(lib, p)
  return lib
}

async function startWith(saved: Workspace) {
  const storage = memoryStorage()
  await storage.save(saved)
  await useWorkspace.getState().init(storage)
}

function renderLibrary() {
  return render(
    <>
      <LibraryScreen />
      <Toasts />
    </>,
  )
}

const grid = () => screen.getByRole('list', { name: 'Paintings' })
const cardTitles = () =>
  within(grid())
    .queryAllByRole('listitem')
    .map((li) => within(li).getByRole('heading').textContent)

const sample = () => [
  painting('Sunset Chapel', 'Sam', 'ready'),
  painting('Night Rose', 'Alex', 'draft'),
  painting('Frost Oculus', 'Zoé', 'published'),
  painting('Autumn Door', 'Alex', 'published'),
]

describe('LibraryScreen', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    useLanguage.setState({ language: 'en' })
    useNavigation.setState({ screen: { name: 'library' } })
    useToasts.setState({ toasts: [] })
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows the library chip and an export button with the count of new paintings', async () => {
    await startWith({ library: library(sample()), loose: [], assets: {} })
    renderLibrary()
    expect(screen.getByText('Our paintings · v7 · 4 paintings')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Export · 2 new' }))
    expect(useNavigation.getState().screen).toEqual({ name: 'export' })
  })

  it('agrees French counts with the noun, singular for 0 and 1', async () => {
    useLanguage.setState({ language: 'fr' })
    await startWith({ library: library([painting('Seul', 'Sam')]), loose: [], assets: {} })
    renderLibrary()
    expect(screen.getByRole('button', { name: 'Exporter · 1 nouveau' })).toBeInTheDocument()
    act(() => useWorkspace.getState().createLibrary('Vide', 'vide'))
    expect(screen.getByText('Vide · v0 · 0 tableau')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exporter · 0 nouveau' })).toBeInTheDocument()
  })

  it('keeps Export enabled when nothing is new', async () => {
    await startWith({
      library: library([painting('Old', 'Sam', 'published')]),
      loose: [],
      assets: {},
    })
    renderLibrary()
    expect(screen.getByRole('button', { name: 'Export · 0 new' })).toBeEnabled()
  })

  it('narrows the grid with the filters and with an accent-insensitive search', async () => {
    await startWith({ library: library(sample()), loose: [], assets: {} })
    renderLibrary()
    expect(cardTitles()).toHaveLength(4)

    await userEvent.click(screen.getByRole('button', { name: 'New 2' }))
    expect(cardTitles()).toEqual(['Sunset Chapel', 'Night Rose'])
    await userEvent.click(screen.getByRole('button', { name: 'Published 2' }))
    expect(cardTitles()).toEqual(['Frost Oculus', 'Autumn Door'])
    expect(screen.getByRole('button', { name: 'Published 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(screen.getByRole('button', { name: 'All 4' }))

    const search = screen.getByRole('searchbox', { name: 'Search title or author' })
    await userEvent.type(search, 'ZOE')
    expect(cardTitles()).toEqual(['Frost Oculus'])
    await userEvent.clear(search)
    await userEvent.type(search, 'rose')
    expect(cardTitles()).toEqual(['Night Rose'])
    await userEvent.clear(search)
    await userEvent.type(search, 'nothing like this')
    expect(cardTitles()).toEqual([])
    expect(screen.getByText('No paintings match your search.')).toBeInTheDocument()
  })

  it('shows a badge in every card: New, Draft or Published with a lock', async () => {
    await startWith({ library: library(sample()), loose: [], assets: {} })
    renderLibrary()
    const [ready, draft, published] = within(grid()).getAllByRole('listitem')
    expect(within(ready as HTMLElement).getByText('New')).toBeInTheDocument()
    expect(within(draft as HTMLElement).getByText('Draft')).toBeInTheDocument()
    expect(within(published as HTMLElement).getByText('Published')).toBeInTheDocument()
    expect(within(ready as HTMLElement).getByText('Sam · 2×3')).toBeInTheDocument()
  })

  it('opens a painting in the editor when its card is clicked', async () => {
    const lib = library(sample())
    await startWith({ library: lib, loose: [], assets: {} })
    renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'Night Rose' }))
    expect(useNavigation.getState().screen).toEqual({
      name: 'editor',
      paintingId: lib.paintings[1]?.id,
    })
  })

  it('offers no Delete for a published painting', async () => {
    await startWith({ library: library(sample()), loose: [], assets: {} })
    renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Frost Oculus' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('closes the card menu on Escape and gives focus back to its button', async () => {
    await startWith({ library: library(sample()), loose: [], assets: {} })
    renderLibrary()
    const button = screen.getByRole('button', { name: 'Actions for Night Rose' })
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('deletes a draft only after confirming', async () => {
    await startWith({ library: library(sample()), loose: [], assets: {} })
    renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Night Rose' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this painting?' })
    expect(dialog).toHaveTextContent('"Night Rose"')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(cardTitles()).toContain('Night Rose')

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Night Rose' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete this painting?' })).getByRole('button', {
        name: 'Delete',
      }),
    )
    expect(cardTitles()).not.toContain('Night Rose')
    expect(useWorkspace.getState().library?.paintings).toHaveLength(3)
  })

  it('duplicates a painting as a new draft', async () => {
    await startWith({ library: library(sample()), loose: [], assets: {} })
    renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Frost Oculus' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
    expect(cardTitles().filter((t) => t === 'Frost Oculus')).toHaveLength(2)
    expect(useWorkspace.getState().library?.paintings.at(-1)?.status).toBe('draft')
  })

  it('moves loose paintings into the library from the banner', async () => {
    const loose = [painting('Harvest Moon', 'Sam', 'draft'), painting('Tide', 'Sam', 'draft')]
    await startWith({ library: library(sample()), loose, assets: {} })
    renderLibrary()
    expect(
      screen.getByText("2 paintings made in this browser aren't in a library yet"),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add to Our paintings' }))
    expect(useWorkspace.getState().loose).toEqual([])
    expect(cardTitles()).toEqual(expect.arrayContaining(['Harvest Moon', 'Tide']))
    expect(screen.queryByRole('button', { name: 'Add to Our paintings' })).not.toBeInTheDocument()
    expect(await screen.findByText('Added 2 paintings to Our paintings')).toBeInTheDocument()
  })

  it('hides the loose banner for now with Later', async () => {
    const loose = [painting('Harvest Moon', 'Sam', 'draft')]
    await startWith({ library: library(sample()), loose, assets: {} })
    renderLibrary()
    expect(
      screen.getByText("1 painting made in this browser isn't in a library yet"),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(screen.queryByText(/made in this browser/)).not.toBeInTheDocument()
    expect(useWorkspace.getState().loose).toHaveLength(1)
  })

  it('keeps the loose banner dismissed across visits until a new loose painting appears', async () => {
    const loose = [painting('Harvest Moon', 'Sam', 'draft')]
    await startWith({ library: library(sample()), loose, assets: {} })
    const first = renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'Later' }))
    first.unmount()

    renderLibrary()
    expect(screen.queryByText(/made in this browser/)).not.toBeInTheDocument()

    act(() => {
      useWorkspace.setState((s) => ({ loose: [...s.loose, painting('Tide', 'Sam', 'draft')] }))
    })
    expect(
      screen.getByText("2 paintings made in this browser aren't in a library yet"),
    ).toBeInTheDocument()
  })

  it('imports a friend’s library pack and says how many paintings it added', async () => {
    const mine = library([painting('Sunset Chapel', 'Sam')])
    await startWith({ library: mine, loose: [], assets: {} })
    const theirs = library([painting('Friend One', 'Lou'), painting('Friend Two', 'Lou')])
    const { bytes } = await writeLibraryPack(
      theirs,
      theirs.paintings.map((p) => p.id),
      {},
      now,
    )
    renderLibrary()
    const input = screen.getByLabelText("Import a friend's library")
    await userEvent.upload(input, new File([bytes as BlobPart], 'ours-v7.zip'))
    expect(await screen.findByText('Added 2 paintings')).toBeInTheDocument()
    expect(cardTitles()).toEqual(['Sunset Chapel', 'Friend One', 'Friend Two'])
  })

  it('shows a translated error when the imported file is not a library pack', async () => {
    await startWith({ library: library(sample()), loose: [], assets: {} })
    renderLibrary()
    await userEvent.upload(
      screen.getByLabelText("Import a friend's library"),
      new File(['nope'], 'notes.zip'),
    )
    expect(await screen.findByText("This file isn't a Shape library pack.")).toBeInTheDocument()
  })

  it('closes the library after confirming and goes home', async () => {
    const loose = [painting('Harvest Moon', 'Sam', 'draft')]
    await startWith({ library: library(sample()), loose, assets: {} })
    renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'Close library' }))
    const dialog = screen.getByRole('dialog', { name: 'Close library' })
    expect(dialog).toHaveTextContent('It stays in your last downloaded library pack.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close library' }))
    expect(useWorkspace.getState().library).toBeNull()
    expect(useNavigation.getState().screen).toEqual({ name: 'home' })
  })

  it('lists loose paintings when no library is open', async () => {
    const loose = [painting('Harvest Moon', 'Sam', 'draft')]
    await startWith({ library: null, loose, assets: {} })
    renderLibrary()
    expect(
      screen.getByRole('heading', { name: 'Your paintings (not in a library yet)' }),
    ).toBeInTheDocument()
    expect(cardTitles()).toEqual(['Harvest Moon'])
    expect(screen.getByRole('button', { name: 'Start a new library' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Export/ })).not.toBeInTheDocument()
  })

  it('goes back home from the logo without closing anything', async () => {
    const loose = [painting('Harvest Moon', 'Sam', 'draft')]
    await startWith({ library: null, loose, assets: {} })
    renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'Shape · Home' }))
    expect(useNavigation.getState().screen).toEqual({ name: 'home' })
    expect(useWorkspace.getState().loose).toHaveLength(1)
  })

  it('sends the player home when there is nothing to show', async () => {
    await startWith({ library: null, loose: [], assets: {} })
    renderLibrary()
    expect(useNavigation.getState().screen).toEqual({ name: 'home' })
  })

  it('creates a new painting and opens it in the editor', async () => {
    await startWith({ library: library(sample()), loose: [], assets: {} })
    renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'New painting' }))
    const screenNow = useNavigation.getState().screen
    expect(screenNow.name).toBe('editor')
    expect(useWorkspace.getState().library?.paintings).toHaveLength(5)
  })
})
