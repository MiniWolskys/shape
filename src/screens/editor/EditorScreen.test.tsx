import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLibrary, createPainting, upsertPainting } from '../../domain/library.ts'
import type { Painting, Workspace } from '../../domain/types.ts'
import { useLanguage } from '../../i18n/i18n.ts'
import { createEditLayer } from '../../imaging/edits.ts'
import { createRaster } from '../../imaging/raster.ts'
import { decodeEditLayer, encodePng } from '../../packs/png.ts'
import { useEditor } from '../../state/editor.ts'
import { useNavigation } from '../../state/navigation.ts'
import { useWorkspace } from '../../state/workspace.ts'
import { memoryStorage } from '../../storage/persistence.ts'
import { Toasts } from '../../ui/Toasts.tsx'
import { useToasts } from '../../ui/toastStore.ts'
import { EditorScreen } from './EditorScreen.tsx'

const now = new Date('2026-10-15T12:00:00Z')

function painting(over: Partial<Painting> = {}): Painting {
  const p = createPainting({ title: 'Sunset Chapel', width: 2, height: 3 }, now, () => 0.5)
  return { ...p, pixelsPerBlock: 4, ...over }
}

async function startWith(p: Painting, extra: Partial<Workspace> = {}) {
  const storage = memoryStorage()
  await storage.save({
    library: upsertPainting(createLibrary('Ours', 'ours'), p),
    loose: [],
    assets: {},
    ...extra,
  })
  await useWorkspace.getState().init(storage)
}

function renderEditor(id: string) {
  return render(
    <>
      <EditorScreen paintingId={id} />
      <Toasts />
    </>,
  )
}

const rail = () => screen.getByRole('navigation', { name: 'Steps' })
const title = () => useEditor.getState().painting?.title

describe('EditorScreen', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    useLanguage.setState({ language: 'en' })
    useToasts.setState({ toasts: [] })
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows the title, size chip and a rail with the five steps', async () => {
    const p = painting()
    await startWith(p)
    useNavigation.setState({ screen: { name: 'editor', paintingId: p.id } })
    renderEditor(p.id)
    expect(screen.getByRole('heading', { name: 'Sunset Chapel', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('2×3 blocks · 4 px per block')).toBeInTheDocument()
    const steps = within(rail()).getAllByRole('button')
    expect(steps.map((b) => b.textContent)).toEqual([
      '1Image',
      '2Size & crop',
      '3Window & frame',
      '4Colors & pixels',
      '5Details',
    ])
    expect(steps[0]).toHaveAttribute('aria-current', 'step')
  })

  it('switches steps from the rail', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    expect(screen.getByRole('heading', { name: 'Picture' })).toBeInTheDocument()
    await userEvent.click(within(rail()).getByRole('button', { name: /Size & crop/ }))
    expect(useEditor.getState().step).toBe('size')
    expect(screen.getByRole('grid', { name: 'Painting size in blocks' })).toBeInTheDocument()
    expect(within(rail()).getByRole('button', { name: /Size & crop/ })).toHaveAttribute(
      'aria-current',
      'step',
    )
    await userEvent.click(within(rail()).getByRole('button', { name: /Details/ }))
    expect(screen.getByText('This step is coming soon.')).toBeInTheDocument()
  })

  it('undoes with Ctrl+Z and redoes with Ctrl+Y and Ctrl+Shift+Z', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    act(() => useEditor.getState().change((q) => ({ ...q, title: 'Changed' })))
    await userEvent.keyboard('{Control>}z{/Control}')
    expect(title()).toBe('Sunset Chapel')
    await userEvent.keyboard('{Control>}y{/Control}')
    expect(title()).toBe('Changed')
    await userEvent.keyboard('{Control>}z{/Control}')
    await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(title()).toBe('Changed')
  })

  it('leaves Ctrl+Z inside a text input to the input', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    act(() => useEditor.getState().change((q) => ({ ...q, title: 'Changed' })))
    const input = document.createElement('input')
    input.type = 'text'
    document.body.append(input)
    input.focus()
    await userEvent.keyboard('{Control>}z{/Control}')
    expect(title()).toBe('Changed')
    await userEvent.keyboard('b')
    expect(useEditor.getState().tool).toBe('pencil')
    input.remove()
  })

  it('picks tools with their letters outside text inputs', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    await userEvent.keyboard('g')
    expect(useEditor.getState().tool).toBe('fill')
    await userEvent.keyboard('w')
    expect(useEditor.getState().tool).toBe('wand')
  })

  it('disables the size picker and presets for a published painting', async () => {
    const p = painting({ status: 'published', publishedIn: 1 })
    await startWith(p)
    renderEditor(p.id)
    await userEvent.click(within(rail()).getByRole('button', { name: /Size & crop/ }))
    const grid = screen.getByRole('grid', { name: 'Painting size in blocks' })
    expect(grid).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: '2×2' })).toBeDisabled()
    expect(
      screen.getByText("This painting is published, so its size can't change anymore."),
    ).toBeInTheDocument()
    fireEvent.click(within(grid).getAllByRole('gridcell')[0] as HTMLElement)
    expect(useEditor.getState().painting).toMatchObject({ width: 2, height: 3 })
  })

  it('resizes from a preset and from the keyboard on the block grid', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    await userEvent.click(within(rail()).getByRole('button', { name: /Size & crop/ }))
    await userEvent.click(screen.getByRole('button', { name: '4×2' }))
    expect(useEditor.getState().painting).toMatchObject({ width: 4, height: 2 })

    const grid = screen.getByRole('grid', { name: 'Painting size in blocks' })
    grid.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowDown}')
    expect(screen.getByText('5 × 3 blocks')).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    expect(useEditor.getState().painting).toMatchObject({ width: 5, height: 3 })
  })

  it('saves with Ctrl+S: edits go to assets and updatedAt changes', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    const layer = createEditLayer(8, 12)
    layer.mask[3] = 1
    layer.values.data.set([1, 2, 3, 255], 12)
    act(() => {
      useEditor.getState().change((q) => ({ ...q, title: 'Renamed' }))
      useEditor.getState().setEdits(layer)
    })
    await userEvent.keyboard('{Control>}s{/Control}')

    const stored = useWorkspace.getState().findPainting(p.id)
    expect(stored?.title).toBe('Renamed')
    expect(stored?.updatedAt).not.toBe(p.updatedAt)
    const editsId = stored?.recipe.editsId
    expect(editsId).toMatch(/^[A-Za-z0-9_-]+$/)
    const assets = useWorkspace.getState().assets
    const values = editsId ? assets[editsId] : undefined
    const mask = editsId ? assets[`${editsId}.mask`] : undefined
    expect(values && mask && decodeEditLayer(values, mask).mask[3]).toBe(1)
    expect(useEditor.getState().dirty).toBe(false)
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('opens the stored picture and edits', async () => {
    const source = createRaster(6, 6, [10, 20, 30, 255])
    const p = painting({
      recipe: {
        ...painting().recipe,
        source: { imageId: 'pic', width: 6, height: 6 },
      },
    })
    await startWith(p, { assets: { pic: encodePng(source) } })
    renderEditor(p.id)
    expect(useEditor.getState().source?.width).toBe(6)
    expect(screen.getByText('6×6 px picture')).toBeInTheDocument()
  })

  it('asks before leaving with unsaved changes', async () => {
    const p = painting()
    await startWith(p)
    useNavigation.setState({ screen: { name: 'editor', paintingId: p.id } })
    renderEditor(p.id)
    act(() => useEditor.getState().change((q) => ({ ...q, title: 'Changed' })))
    await userEvent.click(screen.getByRole('button', { name: 'Library' }))
    const dialog = screen.getByRole('dialog', { name: 'Save your changes?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(useNavigation.getState().screen.name).toBe('editor')

    await userEvent.click(screen.getByRole('button', { name: 'Library' }))
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(useNavigation.getState().screen).toEqual({ name: 'library' })
    expect(useWorkspace.getState().findPainting(p.id)?.title).toBe('Sunset Chapel')
  })

  it('saves and leaves from the unsaved-changes dialog', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    act(() => useEditor.getState().change((q) => ({ ...q, title: 'Changed' })))
    await userEvent.click(screen.getByRole('button', { name: 'Library' }))
    const dialog = screen.getByRole('dialog', { name: 'Save your changes?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(useNavigation.getState().screen).toEqual({ name: 'library' })
    expect(useWorkspace.getState().findPainting(p.id)?.title).toBe('Changed')
  })

  it('warns before unloading the page while there are unsaved changes', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    act(() => useEditor.getState().change((q) => ({ ...q, title: 'Changed' })))
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })

  it('goes to the library with a message when the painting does not exist', async () => {
    await startWith(painting())
    renderEditor('missing_abc')
    expect(useNavigation.getState().screen).toEqual({ name: 'library' })
    expect(screen.getByText("This painting doesn't exist anymore.")).toBeInTheDocument()
  })
})
