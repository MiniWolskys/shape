import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShapeError } from '../../domain/errors.ts'
import { createLibrary, createPainting, upsertPainting } from '../../domain/library.ts'
import type { Assets, Library, Painting, PaintingStatus } from '../../domain/types.ts'
import { useLanguage } from '../../i18n/i18n.ts'
import * as libraryPack from '../../packs/libraryPack.ts'
import { encodePng } from '../../packs/png.ts'
import { useNavigation } from '../../state/navigation.ts'
import { useWorkspace } from '../../state/workspace.ts'
import { memoryStorage } from '../../storage/persistence.ts'
import * as download from '../../ui/download.ts'
import { Toasts } from '../../ui/Toasts.tsx'
import { useToasts } from '../../ui/toastStore.ts'
import { ExportScreen } from './ExportScreen.tsx'

// Thumbnails render on idle callbacks; their own tests cover them.
vi.mock('../../state/thumbnails.ts', () => ({ useThumbnail: () => null }))

const now = new Date('2026-10-15T12:00:00Z')
let seed = 0

const IMAGE = 'img_1'
const assets: Assets = {
  [IMAGE]: encodePng({ width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(200) }),
}

function painting(
  title: string,
  author: string,
  status: PaintingStatus = 'ready',
  publishedIn?: number,
): Painting {
  seed += 1
  const p = createPainting({ title, author, pixelsPerBlock: 4 }, now, () => 0.5)
  return {
    ...p,
    id: `${p.id}_${seed}`,
    status,
    ...(publishedIn === undefined ? {} : { publishedIn }),
    recipe: { ...p.recipe, source: { imageId: IMAGE, width: 4, height: 4 } },
  }
}

function library(paintings: Painting[], version = 7): Library {
  let lib = { ...createLibrary('Our paintings', 'ours'), version }
  for (const p of paintings) lib = upsertPainting(lib, p)
  return lib
}

async function startWith(lib: Library | null, extraAssets: Assets = assets) {
  const storage = memoryStorage()
  await storage.save({ library: lib, loose: [], assets: extraAssets })
  await useWorkspace.getState().init(storage)
}

function renderExport() {
  return render(
    <>
      <ExportScreen />
      <Toasts />
    </>,
  )
}

const downloadButton = () => screen.getByRole('button', { name: 'Download library pack' })
const checkbox = (name: string) => screen.getByRole('checkbox', { name })

describe('ExportScreen', () => {
  let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    useLanguage.setState({ language: 'en' })
    useNavigation.setState({ screen: { name: 'export' } })
    useToasts.setState({ toasts: [] })
    writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('checks ready paintings, leaves drafts unchecked, and locks published ones', async () => {
    await startWith(
      library([
        painting('Sunset Chapel', 'Sam'),
        painting('Night Rose', 'Alex', 'draft'),
        painting('Frost Oculus', 'Zoé', 'published', 3),
      ]),
    )
    renderExport()
    expect(checkbox('Sunset Chapel')).toBeChecked()
    expect(checkbox('Night Rose')).not.toBeChecked()
    expect(screen.getByText('draft, not ready')).toBeInTheDocument()
    expect(checkbox('Frost Oculus')).toBeChecked()
    expect(checkbox('Frost Oculus')).toBeDisabled()
    expect(screen.getByText('since v3')).toBeInTheDocument()
    expect(screen.getByText('v7')).toBeInTheDocument()
    expect(screen.getByText('v8')).toBeInTheDocument()
    expect(screen.getByText('ours-v8.zip')).toBeInTheDocument()
    expect(screen.getByText('Appears after download')).toBeInTheDocument()
  })

  it('collapses published paintings after five', async () => {
    const published = Array.from({ length: 8 }, (_, i) =>
      painting(`Old ${i + 1}`, 'Sam', 'published', 1),
    )
    await startWith(library(published))
    renderExport()
    expect(screen.queryByRole('checkbox', { name: 'Old 6' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '+ 3 more published' }))
    expect(checkbox('Old 8')).toBeInTheDocument()
  })

  it('disables the download while a blocking issue remains, naming the painting', async () => {
    const broken = painting('Night Rose', 'Alex')
    await startWith(
      library([
        painting('Sunset Chapel', 'Sam'),
        { ...broken, recipe: { ...broken.recipe, source: null } },
      ]),
    )
    renderExport()
    expect(screen.getByText('"Night Rose" has no picture.')).toBeInTheDocument()
    expect(downloadButton()).toBeDisabled()
    await userEvent.click(checkbox('Night Rose'))
    expect(screen.queryByText('"Night Rose" has no picture.')).not.toBeInTheDocument()
    expect(downloadButton()).toBeEnabled()
  })

  it('allows exporting with nothing new, with a warning', async () => {
    await startWith(library([painting('Old', 'Sam', 'published', 2)]))
    renderExport()
    expect(screen.getByText(/No new paintings are selected/)).toBeInTheDocument()
    expect(downloadButton()).toBeEnabled()
  })

  it('downloads the pack, publishes the selected paintings and shows the SHA1', async () => {
    const save = vi.spyOn(download, 'downloadBytes').mockImplementation(() => {})
    const sunset = painting('Sunset Chapel', 'Sam')
    const night = painting('Night Rose', 'Alex', 'draft')
    const old = painting('Frost Oculus', 'Zoé', 'published', 3)
    await startWith(library([sunset, night, old]))
    renderExport()

    await userEvent.click(downloadButton())

    const sha1 = await screen.findByTestId('sha1')
    expect(sha1.textContent).toMatch(/^[0-9a-f]{40}$/)
    expect(save).toHaveBeenCalledTimes(1)
    const [bytes, fileName, mime] = save.mock.calls[0] ?? []
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(fileName).toBe('ours-v8.zip')
    expect(mime).toBe('application/zip')

    const lib = useWorkspace.getState().library
    expect(lib?.version).toBe(8)
    expect(lib?.paintings.find((p) => p.id === sunset.id)?.status).toBe('published')
    expect(lib?.paintings.find((p) => p.id === sunset.id)?.publishedIn).toBe(8)
    expect(lib?.paintings.find((p) => p.id === night.id)?.status).toBe('draft')

    expect(screen.getByText("What's new in v8")).toBeInTheDocument()
    expect(screen.getByText('Sunset Chapel by Sam')).toBeInTheDocument()
    expect(screen.getByTestId('server-properties').textContent).toBe(
      libraryPack.serverPropertiesLines(sha1.textContent ?? ''),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Copy the SHA1' }))
    expect(writeText).toHaveBeenLastCalledWith(sha1.textContent)
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('copies the new paintings for Discord', async () => {
    vi.spyOn(download, 'downloadBytes').mockImplementation(() => {})
    await startWith(
      library([painting('Sunset Chapel', 'Sam'), painting('Spring Window', 'Lou')], 0),
    )
    renderExport()
    await userEvent.click(downloadButton())
    await userEvent.click(await screen.findByRole('button', { name: 'Copy for Discord' }))
    expect(writeText).toHaveBeenLastCalledWith(
      '**Our paintings v1**\n- Sunset Chapel by Sam\n- Spring Window by Lou',
    )
  })

  it('writes the Discord text in French, and says when nothing is new', async () => {
    vi.spyOn(download, 'downloadBytes').mockImplementation(() => {})
    useLanguage.setState({ language: 'fr' })
    await startWith(library([painting('Vieux', 'Sam', 'published', 2)], 2))
    renderExport()
    await userEvent.click(
      screen.getByRole('button', { name: 'Télécharger le pack de bibliothèque' }),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Copier pour Discord' }))
    expect(writeText).toHaveBeenLastCalledWith(
      '**Our paintings v3**\n- Aucun nouveau tableau dans cette version.',
    )
  })

  it('shows the server.properties lines with a French link placeholder', async () => {
    useLanguage.setState({ language: 'fr' })
    await startWith(library([painting('Vieux', 'Sam')]))
    renderExport()
    expect(screen.getByText(/resource-pack=<votre lien direct>/)).toBeInTheDocument()
    expect(screen.queryByText(/your direct link/)).not.toBeInTheDocument()
  })

  it('falls back to selecting the text when the clipboard API is missing', async () => {
    vi.spyOn(download, 'downloadBytes').mockImplementation(() => {})
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    await startWith(library([painting('Sunset Chapel', 'Sam')]))
    renderExport()
    await userEvent.click(downloadButton())
    await userEvent.click(
      await screen.findByRole('button', { name: 'Copy the server.properties lines' }),
    )
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('explains a failed export in the active language and keeps the library unpublished', async () => {
    vi.spyOn(libraryPack, 'writeLibraryPack').mockRejectedValue(
      new ShapeError('export-failed', 'The stored picture of painting "X" (x) is damaged: bad crc'),
    )
    const save = vi.spyOn(download, 'downloadBytes').mockImplementation(() => {})
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    useLanguage.setState({ language: 'fr' })
    await startWith(library([painting('Sunset Chapel', 'Sam')]))
    renderExport()
    await userEvent.click(
      screen.getByRole('button', { name: 'Télécharger le pack de bibliothèque' }),
    )
    const message = await screen.findByText(/L'export a échoué/)
    expect(message.textContent).not.toMatch(/damaged/)
    expect(logged).toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(useWorkspace.getState().library?.version).toBe(7)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Télécharger le pack de bibliothèque' }),
      ).toBeEnabled(),
    )
  })

  it('sends players without a library home with an explanation', async () => {
    await startWith(null)
    renderExport()
    await act(async () => {})
    expect(useNavigation.getState().screen).toEqual({ name: 'home' })
    const toasts = within(document.body).getByText(/needs a library/)
    expect(toasts).toBeInTheDocument()
  })
})
