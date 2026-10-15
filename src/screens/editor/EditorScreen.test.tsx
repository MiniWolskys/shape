import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createLibrary, createPainting, upsertPainting } from '../../domain/library.ts'
import type { Painting, Workspace } from '../../domain/types.ts'
import { useLanguage } from '../../i18n/i18n.ts'
import { createEditLayer } from '../../imaging/edits.ts'
import { createRaster } from '../../imaging/raster.ts'
import { decodeEditLayer, encodePng } from '../../packs/png.ts'
import * as png from '../../packs/png.ts'
import { forgetLastSteps, useEditor } from '../../state/editor.ts'
import { useNavigation } from '../../state/navigation.ts'
import { useWorkspace } from '../../state/workspace.ts'
import { memoryStorage } from '../../storage/persistence.ts'
import { Toasts } from '../../ui/Toasts.tsx'
import { useToasts } from '../../ui/toastStore.ts'
import * as decode from '../../imaging/decode.ts'
import { AUTOSAVE_MS } from './autosave.ts'
import { CanvasStage } from './CanvasStage.tsx'
import { EditorScreen } from './EditorScreen.tsx'

const now = new Date('2026-10-15T12:00:00Z')

function painting(over: Partial<Painting> = {}): Painting {
  const p = createPainting({ title: 'Sunset Chapel', width: 2, height: 3 }, now, () => 0.5)
  return { ...p, pixelsPerBlock: 4, ...over }
}

async function startWith(p: Painting | null, extra: Partial<Workspace> = {}) {
  const storage = memoryStorage()
  await storage.save({
    library: p ? upsertPainting(createLibrary('Ours', 'ours'), p) : null,
    loose: [],
    assets: {},
    ...extra,
  })
  await useWorkspace.getState().init(storage)
}

/** The editor as the app shows it: following the route, like App does. */
function Routed() {
  const screenNow = useNavigation((s) => s.screen)
  return screenNow.name === 'editor' ? <EditorScreen paintingId={screenNow.paintingId} /> : null
}

function renderEditor(id: string | null) {
  useNavigation.setState({ screen: { name: 'editor', paintingId: id } })
  return render(
    <>
      <Routed />
      <Toasts />
    </>,
  )
}

const rail = () => screen.getByRole('navigation', { name: 'Steps' })
const title = () => useEditor.getState().painting?.title
const openId = () => useEditor.getState().painting?.id
const saveStatus = () => screen.getByText(/^(Saving…|Saved|Not saved yet|Couldn't save)$/)
const retitle = (next: string) =>
  act(() => useEditor.getState().change((q) => ({ ...q, title: next })))
const allPaintings = () => {
  const { library, loose } = useWorkspace.getState()
  return [...(library?.paintings ?? []), ...loose]
}

describe('EditorScreen', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    useLanguage.setState({ language: 'en' })
    useToasts.setState({ toasts: [] })
    forgetLastSteps()
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows the title, size chip, save state and a rail with the five steps', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    expect(screen.getByRole('heading', { name: 'Sunset Chapel', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('2×3 blocks · 4 px per block')).toBeInTheDocument()
    expect(saveStatus()).toHaveTextContent('Saved')
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument()
    const steps = within(rail()).getAllByRole('button')
    expect(steps.map((b) => b.textContent)).toEqual([
      '1Image, no picture yet',
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

  it('reopens a painting on the step last used for it (M3)', async () => {
    const p = painting()
    await startWith(p)
    const view = renderEditor(p.id)
    await userEvent.click(within(rail()).getByRole('button', { name: /Window & frame/ }))
    view.unmount()
    renderEditor(p.id)
    expect(within(rail()).getByRole('button', { name: /Window & frame/ })).toHaveAttribute(
      'aria-current',
      'step',
    )
  })

  it('undoes with Ctrl+Z and redoes with Ctrl+Y and Ctrl+Shift+Z', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    retitle('Changed')
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
    retitle('Changed')
    const input = document.createElement('input')
    input.type = 'text'
    document.body.append(input)
    input.focus()
    await userEvent.keyboard('{Control>}z{/Control}')
    expect(title()).toBe('Changed')
    await userEvent.keyboard('b')
    expect(useEditor.getState().tool).toBe('pencil')
    expect(useEditor.getState().step).toBe('image')
    input.remove()
  })

  it('picks tools with their letters and goes to Colors & pixels (M3)', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    await userEvent.keyboard('g')
    expect(useEditor.getState().tool).toBe('fill')
    expect(useEditor.getState().step).toBe('pixels')
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

  it('saves at once with Ctrl+S, never letting the browser have it', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    const layer = createEditLayer(8, 12)
    layer.mask[3] = 1
    layer.values.data.set([1, 2, 3, 255], 12)
    act(() => {
      useEditor.getState().change((q) => ({ ...q, author: 'Ana' }))
      useEditor.getState().setEdits(layer)
    })
    expect(saveStatus()).toHaveTextContent('Saving…')
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)

    const stored = useWorkspace.getState().findPainting(p.id)
    expect(stored?.author).toBe('Ana')
    expect(stored?.updatedAt).not.toBe(p.updatedAt)
    const editsId = stored?.recipe.editsId
    expect(editsId).toMatch(/^[A-Za-z0-9_-]+$/)
    const assets = useWorkspace.getState().assets
    const values = editsId ? assets[editsId] : undefined
    const mask = editsId ? assets[`${editsId}.mask`] : undefined
    expect(values && mask && decodeEditLayer(values, mask).mask[3]).toBe(1)
    expect(useEditor.getState().dirty).toBe(false)
    expect(saveStatus()).toHaveTextContent('Saved')
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

  it('Back saves what is pending and goes to the library, without asking', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    act(() => useEditor.getState().change((q) => ({ ...q, author: 'Ana' })))
    await userEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useNavigation.getState().screen).toEqual({ name: 'library' })
    expect(useWorkspace.getState().findPainting(p.id)?.author).toBe('Ana')
  })

  it('stays in the editor when the last save fails on leaving, keeping the picture', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    let imageId = ''
    act(() => {
      imageId = useWorkspace.getState().putAsset(encodePng(createRaster(4, 4)))
      useEditor.getState().setSource(createRaster(4, 4), imageId)
    })
    const realSave = useWorkspace.getState().savePainting
    useWorkspace.setState({
      savePainting: () => {
        throw new Error('disk on fire')
      },
    })
    onTestFinished(() => useWorkspace.setState({ savePainting: realSave }))
    await userEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(useNavigation.getState().screen.name).toBe('editor')
    expect(screen.getByText('Something went wrong: disk on fire')).toBeInTheDocument()
    expect(saveStatus()).toHaveTextContent("Couldn't save")
    expect(useWorkspace.getState().assets[imageId]).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: 'Shape · Home' }))
    expect(useNavigation.getState().screen.name).toBe('editor')
  })

  it('a save that fails half-way leaves the id alone, and the next one adds no copy', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    const layer = createEditLayer(8, 12)
    layer.mask[0] = 1
    act(() => {
      useEditor.getState().change((q) => ({ ...q, title: 'Night Rose' }))
      useEditor.getState().setEdits(layer)
    })
    const encode = vi.spyOn(png, 'encodeEditLayer').mockImplementationOnce(() => {
      throw new Error('no memory')
    })
    await userEvent.keyboard('{Control>}s{/Control}')
    expect(encode).toHaveBeenCalled()
    expect(allPaintings().map((q) => [q.id, q.title])).toEqual([[p.id, 'Sunset Chapel']])
    expect(openId()).toBe(p.id)
    await userEvent.keyboard('{Control>}s{/Control}')
    const id = `night_rose_${p.id.slice(-3)}`
    expect(allPaintings().map((q) => [q.id, q.title])).toEqual([[id, 'Night Rose']])
    expect(openId()).toBe(id)
  })

  it('the logo saves what is pending and goes home (M14)', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    act(() => useEditor.getState().change((q) => ({ ...q, author: 'Ana' })))
    await userEvent.click(screen.getByRole('button', { name: 'Shape · Home' }))
    expect(useNavigation.getState().screen).toEqual({ name: 'home' })
    expect(useWorkspace.getState().findPainting(p.id)?.author).toBe('Ana')
  })

  it('saves when the page is hidden, and asks before unloading only with changes pending', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    act(() => useEditor.getState().change((q) => ({ ...q, author: 'Ana' })))
    const pending = new Event('beforeunload', { cancelable: true })
    act(() => {
      window.dispatchEvent(pending)
    })
    expect(pending.defaultPrevented).toBe(true)
    expect(useWorkspace.getState().findPainting(p.id)?.author).toBe('Ana')

    act(() => useEditor.getState().change((q) => ({ ...q, author: 'Bo' })))
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(useWorkspace.getState().findPainting(p.id)?.author).toBe('Bo')
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

  it('leaving drops a picture that was undone before it was saved', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    act(() => {
      const id = useWorkspace.getState().putAsset(encodePng(createRaster(4, 4)))
      useEditor.getState().setSource(createRaster(4, 4), id)
      useEditor.getState().undo()
    })
    expect(Object.keys(useWorkspace.getState().assets)).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Library' }))
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

  it('sizes a new painting to its first picture and offers to change it (R20)', async () => {
    await startWith(null)
    vi.spyOn(decode, 'fileToRaster').mockResolvedValue(createRaster(400, 300))
    renderEditor(null)
    const input = screen.getByLabelText('Choose a picture')
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.png')] })
    await act(async () => {
      fireEvent.change(input)
    })
    expect(useEditor.getState().painting).toMatchObject({ width: 4, height: 3 })
    expect(screen.getByText('Sized to 4×3 blocks to fit your picture')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(useEditor.getState().step).toBe('size')
  })

  it('says the crop was recentred after a turn, and Undo brings it back (M13)', async () => {
    const p = painting({
      recipe: {
        ...painting().recipe,
        source: { imageId: 'pic', width: 20, height: 30 },
        crop: { x: 2, y: 3, width: 8, height: 12 },
      },
    })
    await startWith(p, { assets: { pic: encodePng(createRaster(20, 30)) } })
    renderEditor(p.id)
    await userEvent.click(screen.getByRole('button', { name: 'Rotate right' }))
    expect(useEditor.getState().painting?.recipe.crop.width).toBe(0)
    const note = screen.getByText('Crop recentred').parentElement as HTMLElement
    await userEvent.click(within(note).getByRole('button', { name: 'Undo' }))
    expect(useEditor.getState().painting?.recipe).toMatchObject({
      rotation: 0,
      crop: { x: 2, y: 3, width: 8, height: 12 },
    })
  })

  it('says nothing when the crop was the centred one anyway', async () => {
    const p = painting({
      recipe: { ...painting().recipe, source: { imageId: 'pic', width: 20, height: 30 } },
    })
    await startWith(p, { assets: { pic: encodePng(createRaster(20, 30)) } })
    renderEditor(p.id)
    await userEvent.click(screen.getByRole('button', { name: 'Flip horizontally' }))
    expect(screen.queryByText('Crop recentred')).not.toBeInTheDocument()
  })
})

describe('EditorScreen autosave (R19) and new paintings (R18)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    useLanguage.setState({ language: 'en' })
    useToasts.setState({ toasts: [] })
    forgetLastSteps()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

  it('saves a change on its own after a short pause, and says so', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    act(() => useEditor.getState().change((q) => ({ ...q, author: 'Ana' })))
    expect(saveStatus()).toHaveTextContent('Saving…')
    await wait(AUTOSAVE_MS - 1)
    expect(useWorkspace.getState().findPainting(p.id)?.author).toBe('')
    await wait(1)
    expect(useWorkspace.getState().findPainting(p.id)?.author).toBe('Ana')
    expect(saveStatus()).toHaveTextContent('Saved')
  })

  it('waits for a held pointer to be released before saving', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    fireEvent.pointerDown(window)
    act(() => useEditor.getState().change((q) => ({ ...q, author: 'Ana' })))
    await wait(AUTOSAVE_MS * 3)
    expect(useWorkspace.getState().findPainting(p.id)?.author).toBe('')
    fireEvent.pointerUp(window)
    await wait(AUTOSAVE_MS)
    expect(useWorkspace.getState().findPainting(p.id)?.author).toBe('Ana')
  })

  it('a new title gives an unpublished painting a new id, and the editor follows it (R17)', async () => {
    const p = painting()
    await startWith(p)
    renderEditor(p.id)
    const suffix = p.id.slice(-3)
    retitle('Rosace du soir')
    await wait(AUTOSAVE_MS)
    const id = `rosace_du_soir_${suffix}`
    expect(openId()).toBe(id)
    expect(useNavigation.getState().screen).toEqual({ name: 'editor', paintingId: id })
    expect(allPaintings().map((q) => [q.id, q.title])).toEqual([[id, 'Rosace du soir']])
    expect(screen.getByRole('heading', { name: 'Rosace du soir', level: 1 })).toBeInTheDocument()

    // Undo stays in the session; saving the older title moves the id back.
    act(() => useEditor.getState().undo())
    expect(title()).toBe('Sunset Chapel')
    await wait(AUTOSAVE_MS)
    expect(allPaintings().map((q) => q.id)).toEqual([p.id])
    expect(openId()).toBe(p.id)
  })

  it('Undo on the crop toast still works after an autosave renamed the painting', async () => {
    const p = painting({
      recipe: {
        ...painting().recipe,
        source: { imageId: 'pic', width: 20, height: 30 },
        crop: { x: 2, y: 3, width: 8, height: 12 },
      },
    })
    await startWith(p, { assets: { pic: encodePng(createRaster(20, 30)) } })
    renderEditor(p.id)
    retitle('Night Rose')
    fireEvent.click(screen.getByRole('button', { name: 'Rotate right' }))
    await wait(AUTOSAVE_MS)
    expect(openId()).toBe(`night_rose_${p.id.slice(-3)}`)
    const note = screen.getByText('Crop recentred').parentElement as HTMLElement
    fireEvent.click(within(note).getByRole('button', { name: 'Undo' }))
    expect(useEditor.getState().painting?.recipe).toMatchObject({
      rotation: 0,
      crop: { x: 2, y: 3, width: 8, height: 12 },
    })
    expect(title()).toBe('Night Rose')
  })

  it('keeps the id of a published painting when its title changes', async () => {
    const p = painting({ status: 'published', publishedIn: 1 })
    await startWith(p)
    renderEditor(p.id)
    retitle('Rosace du soir')
    await wait(AUTOSAVE_MS)
    expect(allPaintings().map((q) => [q.id, q.title])).toEqual([[p.id, 'Rosace du soir']])
  })

  it('a new painting is not saved until it changes, and leaving it leaves nothing', async () => {
    await startWith(null)
    renderEditor(null)
    expect(saveStatus()).toHaveTextContent('Not saved yet')
    await wait(AUTOSAVE_MS * 2)
    expect(allPaintings()).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(allPaintings()).toEqual([])
    expect(useWorkspace.getState().assets).toEqual({})
  })

  it('a new painting enters the workspace on its first change, named after its title', async () => {
    await startWith(painting())
    renderEditor(null)
    const draftId = openId() ?? ''
    retitle('Night Rose')
    await wait(AUTOSAVE_MS)
    const id = openId()
    expect(id).toBe(`night_rose_${draftId.slice(-3)}`)
    // A library is open: the new painting goes into it, after the others.
    expect(useWorkspace.getState().library?.paintings.map((q) => q.id)).toEqual([painting().id, id])
    expect(useNavigation.getState().screen).toEqual({ name: 'editor', paintingId: id })
    expect(saveStatus()).toHaveTextContent('Saved')
  })

  it('without a library a new painting becomes a loose one', async () => {
    await startWith(null)
    renderEditor(null)
    act(() => useEditor.getState().change((q) => ({ ...q, author: 'Ana' })))
    await wait(AUTOSAVE_MS)
    expect(useWorkspace.getState().loose.map((q) => q.author)).toEqual(['Ana'])
  })
})

describe('CanvasStage', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    useLanguage.setState({ language: 'en' })
  })
  afterEach(() => vi.restoreAllMocks())

  const withPicture = () =>
    painting({ recipe: { ...painting().recipe, source: { imageId: 'pic', width: 8, height: 12 } } })

  it('ends a stroke with up when the pointer capture is lost', () => {
    useEditor.getState().open(withPicture(), createRaster(8, 12), null)
    const onPixel = vi.fn()
    render(<CanvasStage onPixel={onPixel} />)
    const surface = screen.getByRole('img', { name: 'The painting' }).parentElement as HTMLElement
    fireEvent.pointerDown(surface, { button: 0, pointerId: 1 })
    fireEvent.lostPointerCapture(surface, { pointerId: 1 })
    fireEvent.pointerMove(surface, { pointerId: 1 })
    expect(onPixel.mock.calls.map((c) => c[2])).toEqual(['down', 'up'])
  })

  it('makes separate drags separate undo steps', () => {
    useEditor.getState().open(withPicture(), createRaster(8, 12), null)
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

  it('without a picture shows a card to add one instead of the painting (I5)', async () => {
    useEditor.getState().open(painting(), null, null)
    let finish: (r: ReturnType<typeof createRaster>) => void = () => {}
    vi.spyOn(decode, 'fileToRaster').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    render(<CanvasStage />)
    expect(screen.queryByRole('img', { name: 'The painting' })).not.toBeInTheDocument()
    const card = screen.getByRole('region', { name: 'Drop, paste or choose a picture' })
    expect(within(card).getByRole('button', { name: 'Browse files' })).toBeInTheDocument()
    fireEvent.drop(card, {
      dataTransfer: { files: [new File(['x'], 'a.png', { type: 'image/png' })], types: ['Files'] },
    })
    await act(async () => finish(createRaster(4, 4)))
    expect(useEditor.getState().painting?.recipe.source).not.toBeNull()
  })
})
