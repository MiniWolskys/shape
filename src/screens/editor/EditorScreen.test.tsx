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
import * as decode from '../../imaging/decode.ts'
import { CanvasStage } from './CanvasStage.tsx'
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
    expect(screen.getByRole('figure', { name: 'In-game preview' })).toBeInTheDocument()
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
  it('saves no edits after undoing them, so reopening shows none', async () => {
    const p = painting()
    await startWith(p)
    const view = renderEditor(p.id)
    const layer = createEditLayer(8, 12)
    layer.mask[0] = 1
    act(() => useEditor.getState().setEdits(layer))
    await userEvent.keyboard('{Control>}s{/Control}')
    const firstId = useWorkspace.getState().findPainting(p.id)?.recipe.editsId
    expect(firstId).toBeTruthy()
    await userEvent.keyboard('{Control>}z{/Control}')
    await userEvent.keyboard('{Control>}s{/Control}')
    expect(useWorkspace.getState().findPainting(p.id)?.recipe.editsId).toBeNull()
    expect(firstId && useWorkspace.getState().assets[firstId]).toBeFalsy()

    view.unmount()
    renderEditor(p.id)
    expect(useEditor.getState().edits).toBeNull()
  })

  it('saving prunes unused assets but keeps pictures the undo history needs', async () => {
    const p = painting()
    await startWith(p, { assets: { orphan: new Uint8Array([1]) } })
    renderEditor(p.id)
    act(() => {
      const ws = useWorkspace.getState()
      const first = ws.putAsset(encodePng(createRaster(4, 4)))
      useEditor.getState().setSource(createRaster(4, 4), first)
      const second = ws.putAsset(encodePng(createRaster(4, 4)))
      useEditor.getState().setSource(createRaster(4, 4), second)
    })
    const ids = () => Object.keys(useWorkspace.getState().assets)
    expect(ids()).toHaveLength(3)
    await userEvent.keyboard('{Control>}s{/Control}')
    // The orphan goes; the first picture stays because Undo can bring it back.
    expect(ids()).toHaveLength(2)
    expect(ids()).not.toContain('orphan')
  })

  it('leaving the editor drops pictures that were never saved', async () => {
    const p = painting()
    await startWith(p)
    const view = renderEditor(p.id)
    act(() => {
      const id = useWorkspace.getState().putAsset(encodePng(createRaster(4, 4)))
      useEditor.getState().setSource(createRaster(4, 4), id)
    })
    expect(Object.keys(useWorkspace.getState().assets)).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Library' }))
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    view.unmount()
    expect(useWorkspace.getState().assets).toEqual({})
  })

  it('shows the picked size after clicking a cell of the block grid', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    await userEvent.click(within(rail()).getByRole('button', { name: /Size & crop/ }))
    const grid = screen.getByRole('grid', { name: 'Painting size in blocks' })
    await userEvent.click(within(grid).getByRole('gridcell', { name: '5 × 4 blocks' }))
    await userEvent.unhover(grid)
    expect(useEditor.getState().painting).toMatchObject({ width: 5, height: 4 })
    expect(screen.getByText('5 × 4 blocks', { selector: 'p' })).toBeInTheDocument()
  })

  it('keeps Ctrl+S from reaching the browser while a dialog is open', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    act(() => useEditor.getState().change((q) => ({ ...q, title: 'Changed' })))
    await userEvent.click(screen.getByRole('button', { name: 'Library' }))
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(useWorkspace.getState().findPainting(p.id)?.title).toBe('Sunset Chapel')
  })

  it('drops a picture that finishes loading after another painting was opened', async () => {
    const p = painting()
    const other = painting({ id: 'other_abc', title: 'Other' })
    await startWith(p)
    useWorkspace.getState().savePainting(other)
    let finish: (r: ReturnType<typeof createRaster>) => void = () => {}
    vi.spyOn(decode, 'fileToRaster').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    renderEditor(p.id)
    const input = screen.getByLabelText('Choose a picture')
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.png')] })
    fireEvent.change(input)
    act(() => useEditor.getState().open(other, null, null))
    await act(async () => finish(createRaster(4, 4)))
    expect(useWorkspace.getState().assets).toEqual({})
    expect(useEditor.getState().painting?.recipe.source).toBeNull()
  })
})

describe('CanvasStage', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    useLanguage.setState({ language: 'en' })
  })
  afterEach(() => vi.restoreAllMocks())

  it('ends a stroke with up when the pointer capture is lost', () => {
    useEditor.getState().open(painting(), null, null)
    const onPixel = vi.fn()
    render(<CanvasStage onPixel={onPixel} />)
    const surface = screen.getByRole('img', { name: 'The painting' }).parentElement as HTMLElement
    fireEvent.pointerDown(surface, { button: 0, pointerId: 1 })
    fireEvent.lostPointerCapture(surface, { pointerId: 1 })
    fireEvent.pointerMove(surface, { pointerId: 1 })
    expect(onPixel.mock.calls.map((c) => c[2])).toEqual(['down', 'up'])
  })

  it('makes separate drags separate undo steps', () => {
    useEditor.getState().open(painting(), null, null)
    render(<CanvasStage onPixel={() => {}} />)
    const surface = screen.getByRole('img', { name: 'The painting' }).parentElement as HTMLElement
    const brighten = (brightness: number) =>
      useEditor
        .getState()
        .change(
          (q) => ({ ...q, recipe: { ...q.recipe, adjust: { ...q.recipe.adjust, brightness } } }),
          { merge: 'stroke' },
        )
    fireEvent.pointerDown(surface, { button: 0, pointerId: 1 })
    act(() => brighten(10))
    fireEvent.pointerUp(surface, { pointerId: 1 })
    fireEvent.pointerDown(surface, { button: 0, pointerId: 1 })
    act(() => brighten(20))
    fireEvent.pointerUp(surface, { pointerId: 1 })
    expect(useEditor.getState().past).toHaveLength(2)
  })
})
