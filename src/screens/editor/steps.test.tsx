import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLibrary, createPainting, upsertPainting } from '../../domain/library.ts'
import type { Painting, Workspace } from '../../domain/types.ts'
import { useLanguage } from '../../i18n/i18n.ts'
import { renderPainting } from '../../imaging/pipeline.ts'
import { createRaster, type RGBA } from '../../imaging/raster.ts'
import { decodeEditLayer, encodePng } from '../../packs/png.ts'
import { useEditor, type EditorStep } from '../../state/editor.ts'
import { useWorkspace } from '../../state/workspace.ts'
import { memoryStorage } from '../../storage/persistence.ts'
import { Toasts } from '../../ui/Toasts.tsx'
import { useToasts } from '../../ui/toastStore.ts'
import * as wallModule from '../../imaging/wall.ts'
import * as windowModule from '../../imaging/window.ts'
import { cachedRender } from '../../state/useRenderedPainting.ts'
import { EditorScreen } from './EditorScreen.tsx'

const now = new Date('2026-10-15T12:00:00Z')
const RED: RGBA = [200, 30, 30, 255]

/** A 2×3 painting at 4 px per block (8×12 px) of one flat colour, without frame or shape. */
function flatPainting(over: Partial<Painting> = {}): Painting {
  const p = createPainting({ title: 'Sunset Chapel', width: 2, height: 3 }, now, () => 0.5)
  return {
    ...p,
    pixelsPerBlock: 4,
    recipe: {
      ...p.recipe,
      source: { imageId: 'pic', width: 8, height: 12 },
      crop: { x: 0, y: 0, width: 8, height: 12 },
      frame: { material: 'none', thickness: 0 },
    },
    ...over,
  }
}

async function open(p: Painting, step: EditorStep, extra: Partial<Workspace> = {}) {
  const storage = memoryStorage()
  await storage.save({
    library: upsertPainting(createLibrary('Ours', 'ours'), p),
    loose: [],
    ...extra,
    assets: { pic: encodePng(createRaster(8, 12, RED)), ...extra.assets },
  })
  await useWorkspace.getState().init(storage)
  const view = render(
    <>
      <EditorScreen paintingId={p.id} />
      <Toasts />
    </>,
  )
  act(() => useEditor.getState().setStep(step))
  return view
}

const recipe = () => useEditor.getState().painting?.recipe
const surface = () => screen.getByRole('img', { name: 'The painting' }).parentElement as HTMLElement

/** The texture the editor would save right now. */
function rendered() {
  const { painting, source, edits } = useEditor.getState()
  if (!painting) throw new Error('no painting open')
  return renderPainting(source, edits, painting)
}

function click(x = 0, y = 0, init: { shiftKey?: boolean } = {}) {
  const el = surface()
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: x, clientY: y, ...init })
  fireEvent.pointerUp(el, { pointerId: 1, clientX: x, clientY: y, ...init })
}

describe('editor steps', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    useLanguage.setState({ language: 'en' })
    useToasts.setState({ toasts: [] })
  })
  afterEach(() => vi.restoreAllMocks())

  describe('Window & frame', () => {
    it('picking a shape changes the window shape and can be undone', async () => {
      await open(flatPainting(), 'window')
      const shapes = screen.getByRole('group', { name: 'Window shape' })
      expect(within(shapes).getAllByRole('button')).toHaveLength(13)
      await userEvent.click(within(shapes).getByRole('button', { name: 'Oculus' }))
      expect(recipe()?.window.shape).toBe('oculus')
      expect(within(shapes).getByRole('button', { name: 'Oculus' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await userEvent.keyboard('{Control>}z{/Control}')
      expect(recipe()?.window.shape).toBe('full')
    })

    it('draws a thumbnail of this painting for every shape once idle', async () => {
      await open(flatPainting(), 'window')
      const shapes = screen.getByRole('group', { name: 'Window shape' })
      await vi.waitFor(() => expect(within(shapes).getAllByRole('img')).toHaveLength(13))
    })

    it('one failing thumbnail does not stop the others', async () => {
      const real = windowModule.applyWindow
      vi.spyOn(windowModule, 'applyWindow').mockImplementation((picture, o) => {
        if (o.shape === 'oculus') throw new Error('broken shape')
        return real(picture, o)
      })
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      await open(flatPainting({ id: 'thumb_fail_abc' }), 'window')
      const shapes = screen.getByRole('group', { name: 'Window shape' })
      await vi.waitFor(() => expect(within(shapes).getAllByRole('img')).toHaveLength(12))
      expect(within(screen.getByRole('button', { name: 'Oculus' })).queryByRole('img')).toBeNull()
      expect(logged).toHaveBeenCalled()
    })

    it('frame material "No frame" disables the thickness slider', async () => {
      await open(flatPainting({ recipe: { ...flatPainting().recipe } }), 'window')
      const thickness = screen.getByRole('slider', { name: 'Frame thickness' })
      expect(thickness).toBeDisabled()
      await userEvent.click(screen.getByRole('button', { name: 'Gilded' }))
      expect(recipe()?.frame.material).toBe('gilded')
      expect(thickness).toBeEnabled()
      fireEvent.change(thickness, { target: { value: '6' } })
      expect(recipe()?.frame.thickness).toBe(6)
      await userEvent.click(screen.getByRole('button', { name: 'No frame' }))
      expect(thickness).toBeDisabled()
    })

    it('sets the glass opacity in percent', async () => {
      await open(flatPainting(), 'window')
      fireEvent.change(screen.getByRole('slider', { name: 'Glass opacity' }), {
        target: { value: '40' },
      })
      expect(recipe()?.window.glassOpacity).toBeCloseTo(0.4)
    })
  })

  describe('Colors & pixels', () => {
    it('fill on a uniform painting edits every pixel', async () => {
      await open(flatPainting(), 'pixels')
      act(() => {
        useEditor.getState().setTool('fill')
        useEditor.getState().setColor([10, 200, 20, 255])
      })
      click()
      const { edits } = useEditor.getState()
      expect(edits?.mask.every((m) => m === 1)).toBe(true)
      expect(Array.from(rendered().data.slice(0, 4))).toEqual([10, 200, 20, 255])
      expect(useEditor.getState().past).toHaveLength(1)
    })

    it('Transparent preset applied to a wand selection makes those pixels see-through', async () => {
      await open(flatPainting(), 'pixels')
      act(() => useEditor.getState().setTool('wand'))
      click()
      expect(screen.getByText('96 px selected', { selector: 'p *' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Transparent' }))
      expect(useEditor.getState().color).toEqual([0, 0, 0, 0])
      await userEvent.click(screen.getByRole('button', { name: 'Apply to selection' }))
      const out = rendered()
      for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(0)
    })

    it('Apply to selection is disabled without a selection; Escape clears it', async () => {
      await open(flatPainting(), 'pixels')
      expect(screen.getByRole('button', { name: 'Apply to selection' })).toBeDisabled()
      act(() => useEditor.getState().setTool('wand'))
      click()
      expect(screen.getByRole('button', { name: 'Apply to selection' })).toBeEnabled()
      await userEvent.keyboard('{Escape}')
      expect(useEditor.getState().selection).toBeNull()
    })

    it('Shift adds to the wand selection', async () => {
      const p = flatPainting()
      await open(p, 'pixels', {
        assets: { pic: encodePng(halves()) },
      })
      act(() => useEditor.getState().setTool('wand'))
      mockRect(8, 12)
      click(0, 0)
      expect(countSelected()).toBe(48)
      click(0, 11)
      expect(countSelected()).toBe(48)
      click(0, 0, { shiftKey: true })
      expect(countSelected()).toBe(96)
    })

    it('a pencil stroke is one undo step', async () => {
      await open(flatPainting(), 'pixels')
      act(() => {
        useEditor.getState().setTool('pencil')
        useEditor.getState().setColor([0, 0, 255, 255])
      })
      mockRect(8, 12)
      const el = surface()
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 3, clientY: 0 })
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 3, clientY: 3 })
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 3, clientY: 3 })
      const mask = useEditor.getState().edits?.mask
      expect([mask?.[0], mask?.[3], mask?.[3 * 8 + 3], mask?.[8]]).toEqual([1, 1, 1, 0])
      expect(useEditor.getState().past).toHaveLength(1)
      await userEvent.keyboard('{Control>}z{/Control}')
      expect(useEditor.getState().edits).toBeNull()
    })

    it('a stroke leaving the painting does not paint along its edge', async () => {
      await open(flatPainting(), 'pixels')
      act(() => useEditor.getState().setTool('pencil'))
      mockRect(8, 12)
      const el = surface()
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 2, clientY: 0 })
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 20, clientY: 5 })
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 20, clientY: 10 })
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 20, clientY: 10 })
      const mask = useEditor.getState().edits?.mask
      expect(mask?.[2]).toBe(1)
      // Nothing along the right edge below where the stroke left the painting.
      for (let y = 5; y < 12; y++) expect(mask?.[y * 8 + 7]).toBe(0)
    })

    it('coalesces a stroke to one edit per frame and pauses the wall preview', async () => {
      await open(flatPainting(), 'pixels')
      act(() => useEditor.getState().setTool('pencil'))
      mockRect(8, 12)
      const frames: FrameRequestCallback[] = []
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb))
      const wall = vi.spyOn(wallModule, 'renderWallPreview')
      let commits = 0
      const stop = useEditor.subscribe((s, prev) => {
        if (s.edits !== prev.edits) commits++
      })
      const el = surface()
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })
      for (let x = 1; x < 6; x++)
        fireEvent.pointerMove(el, { pointerId: 1, clientX: x, clientY: 0 })
      expect(commits).toBe(1) // the dot under the pointer, at once
      act(() => frames.splice(0).forEach((cb) => cb(0)))
      expect(commits).toBe(2) // all five moves in one frame
      expect(wall).not.toHaveBeenCalled()
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 6, clientY: 0 })
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 7, clientY: 0 })
      expect(commits).toBe(3) // up flushes what is left
      stop()
      const mask = useEditor.getState().edits?.mask
      expect(Array.from(mask?.slice(0, 8) ?? [])).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
      expect(useEditor.getState().past).toHaveLength(1)
      await vi.waitFor(() => expect(wall).toHaveBeenCalled())
    })

    it('the eraser paints transparent pixels', async () => {
      await open(flatPainting(), 'pixels')
      act(() => useEditor.getState().setTool('eraser'))
      click()
      expect(rendered().data[3]).toBe(0)
    })

    it('the eyedropper picks the rendered colour and goes back to the previous tool', async () => {
      await open(flatPainting(), 'pixels')
      act(() => useEditor.getState().setTool('fill'))
      await userEvent.keyboard('i')
      expect(useEditor.getState().tool).toBe('eyedropper')
      click()
      expect(useEditor.getState().color).toEqual(RED)
      expect(useEditor.getState().tool).toBe('fill')
    })

    it('hex input rejects #12 and accepts #12ab34', async () => {
      await open(flatPainting(), 'pixels')
      act(() => useEditor.getState().setColor([1, 2, 3, 128]))
      const hex = screen.getByRole('textbox', { name: 'Hex color' })
      await userEvent.clear(hex)
      await userEvent.type(hex, '#12{Enter}')
      expect(hex).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByText('Use #RRGGBB or #RGB.')).toBeInTheDocument()
      expect(useEditor.getState().color).toEqual([1, 2, 3, 128])
      await userEvent.clear(hex)
      await userEvent.type(hex, '#12ab34{Enter}')
      expect(hex).toHaveAttribute('aria-invalid', 'false')
      expect(useEditor.getState().color).toEqual([0x12, 0xab, 0x34, 128])
    })

    it('opacity in percent sets the colour alpha', async () => {
      await open(flatPainting(), 'pixels')
      act(() => useEditor.getState().setColor([1, 2, 3, 255]))
      const opacity = screen.getByRole('spinbutton', { name: 'Opacity' })
      await userEvent.clear(opacity)
      await userEvent.type(opacity, '50{Enter}')
      expect(useEditor.getState().color).toEqual([1, 2, 3, 128])
    })

    it('the Frame preset uses the opaque frame material colour', async () => {
      const p = flatPainting()
      await open(
        { ...p, recipe: { ...p.recipe, frame: { material: 'gilded', thickness: 2 } } },
        'pixels',
      )
      await userEvent.click(screen.getByRole('button', { name: 'Frame' }))
      expect(useEditor.getState().color).toEqual([208, 164, 58, 255])
      await userEvent.click(screen.getByRole('button', { name: 'Lime' }))
      expect(useEditor.getState().color).toEqual([0x80, 0xc7, 0x1f, 255])
    })
  })

  describe('Details', () => {
    it('the title updates the tooltip preview', async () => {
      await open(flatPainting(), 'details')
      const preview = screen.getByRole('figure', { name: 'In-game preview' })
      expect(within(preview).getByText('Sunset Chapel')).toBeInTheDocument()
      expect(within(preview).getByText('2×3')).toBeInTheDocument()
      const input = screen.getByRole('textbox', { name: 'Title' })
      expect(input).toHaveAttribute('maxLength', '64')
      await userEvent.clear(input)
      await userEvent.type(input, 'Night Rose')
      expect(within(preview).getByText('Night Rose')).toBeInTheDocument()
      expect(useEditor.getState().painting?.title).toBe('Night Rose')
    })

    it('sets author, colours and status, and shows the ID read-only', async () => {
      const p = flatPainting()
      await open(p, 'details')
      await userEvent.type(screen.getByRole('textbox', { name: 'Author' }), 'Ana')
      expect(useEditor.getState().painting?.author).toBe('Ana')
      const titleColors = screen.getByRole('radiogroup', { name: 'Title color' })
      await userEvent.click(within(titleColors).getByRole('radio', { name: 'Aqua' }))
      expect(useEditor.getState().painting?.titleColor).toBe('aqua')
      await userEvent.click(screen.getByRole('radio', { name: 'Ready' }))
      expect(useEditor.getState().painting?.status).toBe('ready')
      expect(screen.getByText(p.id)).toBeInTheDocument()
      expect(screen.getByText('Never changes')).toBeInTheDocument()
    })

    it('labels the chosen colours with French punctuation in French', async () => {
      useLanguage.setState({ language: 'fr' })
      await open(flatPainting({ titleColor: 'yellow' }), 'details')
      const group = screen.getByRole('radiogroup', { name: 'Couleur du titre' })
      expect(group.previousElementSibling?.textContent).toBe('Couleur du titre : Jaune')
    })
  })

  it('closing the editor forgets the shared render', async () => {
    const view = await open(flatPainting(), 'pixels')
    expect(cachedRender()).not.toBeNull()
    view.unmount()
    expect(cachedRender()).toBeNull()
  })

  describe('unreadable edits', () => {
    it('keeps the stored edit assets when saving without new edits, and warns once', async () => {
      const p = flatPainting()
      const stored = { ...p, recipe: { ...p.recipe, editsId: 'broken' } }
      const junk = new Uint8Array([1, 2, 3])
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      await open(stored, 'details', {
        assets: { broken: junk, 'broken.mask': junk },
      })
      expect(
        screen.getAllByText(
          "This painting's pixel edits couldn't be read. They are kept as they are until you paint new ones.",
        ),
      ).toHaveLength(1)
      await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), '!')
      await userEvent.keyboard('{Control>}s{/Control}')
      expect(useWorkspace.getState().findPainting(p.id)?.recipe.editsId).toBe('broken')
      const assets = useWorkspace.getState().assets
      expect(Array.from(assets.broken ?? [])).toEqual([1, 2, 3])
      expect(Array.from(assets['broken.mask'] ?? [])).toEqual([1, 2, 3])
      expect(logged).toHaveBeenCalled()
    })

    it('new edits replace the unreadable ones on save', async () => {
      const p = flatPainting()
      const stored = { ...p, recipe: { ...p.recipe, editsId: 'broken' } }
      const junk = new Uint8Array([1, 2, 3])
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await open(stored, 'pixels', { assets: { broken: junk, 'broken.mask': junk } })
      act(() => useEditor.getState().setTool('eraser'))
      click()
      await userEvent.keyboard('{Control>}s{/Control}')
      const editsId = useWorkspace.getState().findPainting(p.id)?.recipe.editsId
      const values = editsId ? useWorkspace.getState().assets[editsId] : undefined
      const mask = editsId ? useWorkspace.getState().assets[`${editsId}.mask`] : undefined
      expect(values && mask && decodeEditLayer(values, mask).mask[0]).toBe(1)
    })
  })
})

/** Top half red, bottom half blue, 8×12. */
function halves() {
  const r = createRaster(8, 12, RED)
  for (let p = 48; p < 96; p++) r.data.set([20, 20, 200, 255], p * 4)
  return r
}

/** Makes the painting surface 1 CSS pixel per painting pixel at the origin. */
function mockRect(width: number, height: number) {
  vi.spyOn(surface(), 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width, height }),
  )
}

function countSelected() {
  const selection = useEditor.getState().selection
  return selection ? selection.reduce((n, v) => n + v, 0) : 0
}
