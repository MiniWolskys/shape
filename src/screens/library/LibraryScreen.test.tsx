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
import { AppFileDrop } from '../AppFileDrop.tsx'
import { LibraryScreen } from './LibraryScreen.tsx'

// Thumbnails render on idle callbacks; their own tests cover them.
vi.mock('../../state/thumbnails.ts', () => ({ useThumbnail: () => null }))

const now = new Date('2026-10-15T12:00:00Z')
let seed = 0

function painting(title: string, author: string, status: PaintingStatus = 'ready'): Painting {
  seed += 1
  const p = createPainting({ title, author, width: 2, height: 3 }, now, () => 0.5)
  const recipe = { ...p.recipe, source: { imageId: 'img', width: 4, height: 4 } }
  return { ...p, id: `${p.id}_${seed}`, status, recipe }
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
      <AppFileDrop />
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

  it('shows the library chip and an export button counting ready paintings (R16)', async () => {
    await startWith({ library: library(sample()), loose: [], assets: {} })
    renderLibrary()
    expect(screen.getByText('Our paintings · v7 · 4 paintings')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Export · 1 ready' }))
    expect(useNavigation.getState().screen).toEqual({ name: 'export' })
  })

  it('counts published paintings changed since the last export (I25)', async () => {
    const changed = { ...painting('Frost Oculus', 'Zoé', 'published'), publishedIn: 7 }
    const lib = {
      ...library([painting('Sunset Chapel', 'Sam'), changed]),
      exportedAt: '2026-10-15T11:00:00.000Z',
    }
    await startWith({ library: lib, loose: [], assets: {} })
    renderLibrary()
    expect(screen.getByRole('button', { name: 'Export · 1 ready · 1 changed' })).toBeEnabled()
    const [, card] = within(grid()).getAllByRole('listitem')
    expect(within(card as HTMLElement).getByText('Changed')).toBeInTheDocument()
  })

  it('counts only ready paintings that have a picture, as Export picks them', async () => {
    const empty = painting('Blank', 'Sam')
    const lib = library([{ ...empty, recipe: { ...empty.recipe, source: null } }])
    await startWith({ library: lib, loose: [], assets: {} })
    renderLibrary()
    expect(screen.getByRole('button', { name: 'Export · 0 ready' })).toBeEnabled()
  })

  it('agrees French counts with the noun, singular for 0 and 1', async () => {
    useLanguage.setState({ language: 'fr' })
    await startWith({ library: library([painting('Seul', 'Sam')]), loose: [], assets: {} })
    renderLibrary()
    expect(screen.getByRole('button', { name: 'Exporter · 1 prêt' })).toBeInTheDocument()
    act(() => useWorkspace.getState().createLibrary('Vide', 'vide'))
    expect(screen.getByText('Vide · v0 · 0 tableau')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exporter · 0 prêt' })).toBeInTheDocument()
  })

  it('keeps Export enabled when nothing is new', async () => {
    await startWith({
      library: library([painting('Old', 'Sam', 'published')]),
      loose: [],
      assets: {},
    })
    renderLibrary()
    expect(screen.getByRole('button', { name: 'Export · 0 ready' })).toBeEnabled()
  })

  it('says the demo is a demo and keeps it out of exports (R23)', async () => {
    await startWith({
      library: { ...library(sample()), namespace: 'sample' },
      loose: [],
      assets: {},
      demo: true,
      demoIds: [],
    })
    renderLibrary()
    expect(
      screen.getByText('This is a demo library — create your own to export.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Export/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Start my library' }))
    expect(screen.getByRole('dialog', { name: 'Start a new library' })).toBeInTheDocument()
  })

  it('offers no Add to the demo for loose paintings (R23)', async () => {
    await startWith({
      library: { ...library(sample()), namespace: 'sample' },
      loose: [painting('Harvest Moon', 'Sam', 'draft')],
      assets: {},
      demo: true,
      demoIds: [],
    })
    renderLibrary()
    const section = screen.getByRole('region', { name: 'Not in this library' })
    expect(within(section).queryByRole('button', { name: /^Add/ })).toBeNull()
    expect(within(section).getByText('Harvest Moon')).toBeInTheDocument()
  })

  it('keeps the demo paintings the player made outside the library when closing it', async () => {
    const lib = { ...library([painting('Sample', 'Shape')]), namespace: 'sample' }
    await startWith({ library: lib, loose: [], assets: {}, demo: true, demoIds: [] })
    renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'Close library' }))
    const dialog = screen.getByRole('dialog', { name: 'Close Our paintings?' })
    expect(dialog).toHaveTextContent(
      '1 painting in the demo is yours (made or changed here). Closing the demo deletes it.',
    )
    expect(within(dialog).getByRole('button', { name: 'Delete 1 and close' })).toBeInTheDocument()
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Keep it outside the library' }),
    )
    expect(useWorkspace.getState().library).toBeNull()
    expect(useWorkspace.getState().loose.map((p) => p.title)).toEqual(['Sample'])
  })

  it('treats a library as a demo by its flag, not by its namespace', async () => {
    await startWith({
      library: { ...library(sample()), namespace: 'sample' },
      loose: [],
      assets: {},
    })
    renderLibrary()
    expect(screen.queryByText(/demo library/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Export · 1 ready' })).toBeEnabled()
  })

  it('narrows the grid with the filters and with an accent-insensitive search', async () => {
    await startWith({ library: library(sample()), loose: [], assets: {} })
    renderLibrary()
    expect(cardTitles()).toHaveLength(4)

    await userEvent.click(screen.getByRole('button', { name: 'Ready 1' }))
    expect(cardTitles()).toEqual(['Sunset Chapel'])
    await userEvent.click(screen.getByRole('button', { name: 'Draft 1' }))
    expect(cardTitles()).toEqual(['Night Rose'])
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

  it('shows a badge in every card: Ready, Draft or Published', async () => {
    await startWith({ library: library(sample()), loose: [], assets: {} })
    renderLibrary()
    const [ready, draft, published] = within(grid()).getAllByRole('listitem')
    expect(within(ready as HTMLElement).getByText('Ready')).toBeInTheDocument()
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

  it('says why a published painting cannot be deleted (M10)', async () => {
    await startWith({ library: library(sample()), loose: [], assets: {} })
    renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Frost Oculus' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument()
    const locked = within(menu).getByRole('menuitem', {
      name: 'Delete — published paintings stay on the server',
    })
    expect(locked).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(locked)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(cardTitles()).toContain('Frost Oculus')
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
        name: 'Delete painting',
      }),
    )
    expect(cardTitles()).not.toContain('Night Rose')
    expect(useWorkspace.getState().library?.paintings).toHaveLength(3)
  })

  it('duplicates a painting as a ready "(copy)" right after the original (I17)', async () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    await startWith({ library: library(sample()), loose: [], assets: {} })
    renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Frost Oculus' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
    const titles = cardTitles()
    expect(titles.indexOf('Frost Oculus (copy)')).toBe(titles.indexOf('Frost Oculus') + 1)
    const copy = useWorkspace.getState().library?.paintings.find((p) => p.title.endsWith('(copy)'))
    expect(copy?.status).toBe('ready')
    const card = screen.getByRole('heading', { name: 'Frost Oculus (copy)' }).closest('li')
    expect(card).toHaveAttribute('data-highlight', 'true')
    expect(scrolled).toHaveBeenCalled()
    expect(await screen.findByText('Duplicated')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(useNavigation.getState().screen).toEqual({ name: 'editor', paintingId: copy?.id })
  })

  it('lists loose paintings next to the library, each with its own Add (I16)', async () => {
    const loose = [painting('Harvest Moon', 'Sam', 'draft'), painting('Tide', 'Sam', 'draft')]
    await startWith({ library: library(sample()), loose, assets: {} })
    renderLibrary()
    const section = screen.getByRole('region', { name: 'Not in this library' })
    expect(section).toHaveTextContent("2 paintings made in this browser aren't in Our paintings")
    const list = within(section).getByRole('list')
    const [harvest] = within(list).getAllByRole('listitem')
    await userEvent.click(
      within(harvest as HTMLElement).getByRole('button', { name: 'Add to Our paintings' }),
    )
    expect(useWorkspace.getState().loose.map((p) => p.title)).toEqual(['Tide'])
    expect(cardTitles()).toContain('Harvest Moon')
    expect(await screen.findByText('Added 1 painting to Our paintings')).toBeInTheDocument()
  })

  it('moves every loose painting into the library at once', async () => {
    const loose = [painting('Harvest Moon', 'Sam', 'draft'), painting('Tide', 'Sam', 'draft')]
    await startWith({ library: library(sample()), loose, assets: {} })
    renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'Add all 2 to Our paintings' }))
    expect(useWorkspace.getState().loose).toEqual([])
    expect(cardTitles()).toEqual(expect.arrayContaining(['Harvest Moon', 'Tide']))
    expect(screen.queryByRole('region', { name: 'Not in this library' })).toBeNull()
    expect(await screen.findByText('Added 2 paintings to Our paintings')).toBeInTheDocument()
  })

  it('folds the loose paintings away without hiding that they exist', async () => {
    const loose = [painting('Harvest Moon', 'Sam', 'draft')]
    await startWith({ library: library(sample()), loose, assets: {} })
    const first = renderLibrary()
    const section = screen.getByRole('region', { name: 'Not in this library' })
    const toggle = within(section).getByRole('button', { name: 'Hide' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(toggle)
    expect(within(section).queryByRole('list')).toBeNull()
    expect(section).toHaveTextContent("1 painting made in this browser isn't in Our paintings")
    first.unmount()

    renderLibrary()
    const again = screen.getByRole('region', { name: 'Not in this library' })
    expect(within(again).queryByRole('list')).toBeNull()
    await userEvent.click(within(again).getByRole('button', { name: 'Show' }))
    expect(within(again).getByRole('list')).toBeInTheDocument()
  })

  it('offers a first painting or a pack in an empty library (M11)', async () => {
    await startWith({ library: library([]), loose: [], assets: {} })
    renderLibrary()
    const empty = screen.getByRole('region', { name: 'No paintings yet' })
    await userEvent.click(within(empty).getByRole('button', { name: 'New painting' }))
    expect(useNavigation.getState().screen).toEqual({ name: 'editor', paintingId: null })
    expect(within(empty).getByRole('button', { name: 'Import a pack' })).toBeInTheDocument()
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
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says when a re-imported pack holds nothing new (M9)', async () => {
    const mine = library([painting('Sunset Chapel', 'Sam'), painting('Night Rose', 'Sam')])
    await startWith({ library: mine, loose: [], assets: {} })
    const { bytes } = await writeLibraryPack(mine, [], {}, now)
    renderLibrary()
    await userEvent.upload(
      screen.getByLabelText("Import a friend's library"),
      new File([bytes as BlobPart], 'ours-v7.zip'),
    )
    expect(
      await screen.findByText('Nothing new: your library already has these 2 paintings.'),
    ).toBeInTheDocument()
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

  it('names the unexported paintings before closing, offering to export first (R15)', async () => {
    const loose = [painting('Harvest Moon', 'Sam', 'draft')]
    await startWith({ library: library(sample()), loose, assets: {} })
    renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'Close library' }))
    const dialog = screen.getByRole('dialog', { name: 'Close Our paintings?' })
    expect(dialog).toHaveTextContent("4 paintings haven't been exported yet")
    expect(dialog).not.toHaveTextContent(/safe/)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Export first' }))
    expect(useNavigation.getState().screen).toEqual({ name: 'export' })
    expect(useWorkspace.getState().library?.paintings).toHaveLength(4)
  })

  it('deletes the unexported paintings only with the danger action, then goes home', async () => {
    const loose = [painting('Harvest Moon', 'Sam', 'draft')]
    await startWith({ library: library(sample()), loose, assets: {} })
    renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'Close library' }))
    const dialog = screen.getByRole('dialog', { name: 'Close Our paintings?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete 4 and close' }))
    expect(useWorkspace.getState().library).toBeNull()
    expect(useWorkspace.getState().loose).toHaveLength(1)
    expect(useNavigation.getState().screen).toEqual({ name: 'home' })
  })

  it('closes an exported library with a plain confirm naming its file', async () => {
    const exported = {
      ...library([painting('Old', 'Sam', 'published')]),
      exportedAt: '2026-10-15T13:00:00.000Z',
    }
    await startWith({ library: exported, loose: [painting('Tide', 'Sam')], assets: {} })
    renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'Close library' }))
    const dialog = screen.getByRole('dialog', { name: 'Close Our paintings?' })
    expect(dialog).toHaveTextContent('ours-v7.zip')
    expect(within(dialog).queryByRole('button', { name: 'Export first' })).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close library' }))
    expect(useWorkspace.getState().library).toBeNull()
  })

  it('asks before closing the demo only about the demo paintings that were changed', async () => {
    const lib = library([painting('Sample', 'Shape')])
    const [only] = lib.paintings
    await startWith({
      library: { ...lib, namespace: 'sample' },
      loose: [],
      assets: {},
      demo: true,
      demoIds: only ? [only.id] : [],
    })
    renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: 'Close library' }))
    const dialog = screen.getByRole('dialog', { name: 'Close Our paintings?' })
    expect(within(dialog).queryByRole('button', { name: 'Export first' })).toBeNull()
    expect(dialog).toHaveTextContent('open the demo again')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close library' }))
    expect(useWorkspace.getState().library).toBeNull()
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

  it('opens a new painting in the editor without adding it yet (R18)', async () => {
    await startWith({ library: library(sample()), loose: [], assets: {} })
    renderLibrary()
    const before = useWorkspace.getState().library?.paintings.length
    await userEvent.click(screen.getByRole('button', { name: 'New painting' }))
    expect(useNavigation.getState().screen).toEqual({ name: 'editor', paintingId: null })
    expect(useWorkspace.getState().library?.paintings).toHaveLength(before ?? -1)
  })
})
