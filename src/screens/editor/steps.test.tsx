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
    useEditor.setState({ brush: 1 })
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
      const { container } = await open(flatPainting({ id: 'thumbs_idle_abc' }), 'window')
      const shapes = screen.getByRole('group', { name: 'Window shape' })
      // Until then, each tile shows the outline of its shape (I9).
      expect(container.querySelectorAll('[data-placeholder]')).toHaveLength(13)
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
      expect(screen.getByText('96 px selected', { selector: 'p' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Transparent' }))
      expect(useEditor.getState().color).toEqual([0, 0, 0, 0])
      await userEvent.click(screen.getByRole('button', { name: 'Apply to selection' }))
      const out = rendered()
      for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(0)
    })

    it('the floating selection bar makes the selection transparent in one click (I7)', async () => {
      await open(flatPainting(), 'pixels', { assets: { pic: encodePng(halves()) } })
      act(() => useEditor.getState().setTool('wand'))
      mockRect(8, 12)
      expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull()
      click(0, 0)
      const bar = screen.getByRole('toolbar', { name: 'Selection' })
      expect(within(bar).getByText('48 px selected')).toBeInTheDocument()
      await userEvent.click(within(bar).getByRole('button', { name: 'Make transparent' }))
      const out = rendered()
      expect(out.data[3]).toBe(0)
      expect(out.data[11 * 8 * 4 + 3]).toBe(255)
      expect(useEditor.getState().past).toHaveLength(1)
      // The colour in use is untouched, and the bar fills with it too.
      act(() => useEditor.getState().setColor([0, 255, 0, 255]))
      await userEvent.click(within(bar).getByRole('button', { name: 'Fill with color' }))
      expect(Array.from(rendered().data.slice(0, 4))).toEqual([0, 255, 0, 255])
      await userEvent.click(within(bar).getByRole('button', { name: 'Clear' }))
      expect(useEditor.getState().selection).toBeNull()
      expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull()
    })

    it('Fit is its own button, off while fitted; the wall view keeps the toolbar in place', async () => {
      await open(flatPainting(), 'pixels')
      const fitButton = screen.getByRole('button', { name: 'Fit' })
      expect(fitButton).toBeDisabled()
      await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
      expect(useEditor.getState().zoom).toBeGreaterThan(0)
      expect(fitButton).toBeEnabled()
      await userEvent.click(fitButton)
      expect(useEditor.getState().zoom).toBe(0)
      act(() => useEditor.getState().setView('wall'))
      expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
      expect(screen.getByRole('radio', { name: 'Sky' })).toBeDisabled()
    })

    describe('moving the view', () => {
      const stage = () => screen.getByRole('group', { name: /^Canvas\./ })
      const space = (target: Element) => fireEvent.keyDown(target, { key: ' ' })

      it('Space keeps working on a focused button, even with the pointer over the canvas', async () => {
        await open(flatPainting(), 'pixels')
        fireEvent.pointerEnter(stage())
        const fill = screen.getByRole('button', { name: 'Fill' })
        fill.focus()
        expect(space(fill)).toBe(true) // not prevented: the button gets its Space
        expect(stage()).not.toHaveAttribute('data-pan')
      })

      it('Space with the canvas focused makes a hand; the drag moves the view, not paint', async () => {
        await open(flatPainting(), 'pixels')
        act(() => useEditor.getState().setTool('pencil'))
        mockRect(8, 12)
        act(() => stage().focus())
        expect(space(stage())).toBe(false) // prevented: the page does not scroll
        expect(stage()).toHaveAttribute('data-pan', 'ready')
        fireEvent.pointerDown(surface(), { button: 0, pointerId: 1, clientX: 2, clientY: 2 })
        expect(stage()).toHaveAttribute('data-pan', 'active')
        fireEvent.pointerUp(stage(), { pointerId: 1, clientX: 2, clientY: 2 })
        fireEvent.keyUp(stage(), { key: ' ' })
        expect(useEditor.getState().edits).toBeNull()
        expect(stage()).not.toHaveAttribute('data-pan')
      })

      it('painting focuses the canvas, and the arrow keys then move the view', async () => {
        await open(flatPainting(), 'pixels')
        mockRect(8, 12)
        act(() => useEditor.getState().setTool('wand'))
        click(1, 1)
        expect(stage()).toHaveFocus()
        const view = stage().querySelector('[data-backdrop]') as HTMLElement
        view.scrollLeft = 100
        view.scrollTop = 300
        fireEvent.keyDown(stage(), { key: 'ArrowRight' })
        fireEvent.keyDown(stage(), { key: 'ArrowUp', shiftKey: true })
        expect(view.scrollLeft).toBe(148)
        expect(view.scrollTop).toBe(60)
      })

      it('the wall view has no hand and no keyboard panning', async () => {
        await open(flatPainting(), 'pixels')
        act(() => useEditor.getState().setView('wall'))
        expect(screen.queryByRole('group', { name: /^Canvas\./ })).toBeNull()
        const area = document.querySelector('[data-view="wall"]') as HTMLElement
        fireEvent.pointerEnter(area)
        expect(space(document.body)).toBe(true)
        expect(area).not.toHaveAttribute('data-pan')
      })
    })

    it('the fitted painting keeps clear of the selection bar while it shows', async () => {
      await open(flatPainting(), 'pixels')
      // The stage is 640×480 here: 8×12 px fits at 37 px per pixel, 31 with the bar's room.
      expect(screen.getByText('3700 %')).toBeInTheDocument()
      act(() => useEditor.getState().setTool('wand'))
      mockRect(8, 12)
      click(1, 1)
      expect(screen.getByRole('toolbar', { name: 'Selection' })).toBeInTheDocument()
      expect(screen.getByText('3100 %')).toBeInTheDocument()
    })

    it('says how the current tool works under the canvas', async () => {
      await open(flatPainting(), 'pixels')
      act(() => useEditor.getState().setTool('wand'))
      expect(
        screen.getByText('Magic wand — click an area to select it, Shift adds. (W)'),
      ).toBeInTheDocument()
      // The tool options sit in one slot: the wand shows its tolerance in percent there.
      expect(screen.getByRole('spinbutton', { name: 'Tolerance (%)' })).toHaveValue(12)
      act(() => useEditor.getState().setTool('pencil'))
      expect(screen.getByRole('radiogroup', { name: 'Brush size' })).toBeInTheDocument()
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

    it('two strokes are two undo steps and never change the edits from before them', async () => {
      await open(flatPainting(), 'pixels')
      act(() => useEditor.getState().setTool('pencil'))
      mockRect(8, 12)
      const el = surface()
      const stroke = (y: number) => {
        fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 0, clientY: y })
        fireEvent.pointerMove(el, { pointerId: 1, clientX: 5, clientY: y })
        fireEvent.pointerUp(el, { pointerId: 1, clientX: 5, clientY: y })
      }
      stroke(1)
      const first = useEditor.getState().edits
      const firstMask = Array.from(first?.mask ?? [])
      stroke(4)
      expect(useEditor.getState().edits?.mask[4 * 8]).toBe(1)
      // The first stroke's layer still holds only the first stroke.
      expect(Array.from(first?.mask ?? [])).toEqual(firstMask)
      expect(first?.mask[4 * 8]).toBe(0)
      expect(useEditor.getState().past).toHaveLength(2)
      act(() => useEditor.getState().undo())
      expect(useEditor.getState().edits).toBe(first)
      // What is on screen is the render of the edits now in place.
      expect(cachedRender()?.data).toEqual(rendered().data)
    })

    it('says so when the painting cannot be drawn, and tools give way instead of failing', async () => {
      await open(flatPainting(), 'pixels')
      const before = cachedRender()
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      const broken = vi.spyOn(windowModule, 'paintWindow').mockImplementation(() => {
        throw new Error('broken window')
      })
      const glass = (glassOpacity: number) =>
        act(() =>
          useEditor.getState().change((p) => ({
            ...p,
            recipe: { ...p.recipe, window: { shape: 'full', glassOpacity } },
          })),
        )
      glass(0.5)
      expect(
        screen.getByText('This painting could not be drawn. Change a setting to try again.'),
      ).toBeInTheDocument()
      expect(cachedRender()).toBe(before)
      expect(logged).toHaveBeenCalled()
      act(() => useEditor.getState().setTool('eyedropper'))
      mockRect(8, 12)
      expect(() => click(1, 1)).not.toThrow()
      expect(
        await screen.findByText('The painting could not be drawn, so this tool can’t be used now.'),
      ).toBeInTheDocument()
      broken.mockRestore()
      glass(0.6)
      expect(
        screen.queryByText('This painting could not be drawn. Change a setting to try again.'),
      ).toBeNull()
      expect(cachedRender()?.data).toEqual(rendered().data)
    })

    describe('history that changes in the middle of a stroke', () => {
      /** A stroke along row 1 whose moves are painted when the test runs the frames. */
      async function strokeWithFrames() {
        await open(flatPainting(), 'pixels')
        act(() => useEditor.getState().setTool('pencil'))
        mockRect(8, 12)
        const frames: FrameRequestCallback[] = []
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb))
        const el = surface()
        const flush = () => act(() => frames.splice(0).forEach((cb) => cb(0)))
        const move = (x: number) => {
          fireEvent.pointerMove(el, { pointerId: 1, clientX: x, clientY: 1 })
          flush()
        }
        fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 0, clientY: 1 })
        move(3)
        return { el, move }
      }
      const row1 = () => Array.from(useEditor.getState().edits?.mask.slice(8, 16) ?? [])

      it('saving mid-stroke keeps the saved pixels as they were saved', async () => {
        const { el, move } = await strokeWithFrames()
        await userEvent.keyboard('{Control>}s{/Control}')
        const saved = useEditor.getState().edits
        expect(useEditor.getState().dirty).toBe(false)
        move(6)
        fireEvent.pointerUp(el, { pointerId: 1, clientX: 6, clientY: 1 })
        expect(row1()).toEqual([1, 1, 1, 1, 1, 1, 1, 0])
        expect(useEditor.getState().dirty).toBe(true)
        act(() => useEditor.getState().undo())
        expect(useEditor.getState().edits).toBe(saved)
        expect(row1()).toEqual([1, 1, 1, 1, 0, 0, 0, 0])
        expect(useEditor.getState().dirty).toBe(false)
      })

      it('undo then redo mid-stroke keeps the redone pixels as they were', async () => {
        const { el, move } = await strokeWithFrames()
        act(() => useEditor.getState().undo())
        act(() => useEditor.getState().redo())
        const redone = useEditor.getState().edits
        move(6)
        fireEvent.pointerUp(el, { pointerId: 1, clientX: 6, clientY: 1 })
        expect(row1()).toEqual([1, 1, 1, 1, 1, 1, 1, 0])
        act(() => useEditor.getState().undo())
        expect(useEditor.getState().edits).toBe(redone)
        expect(row1()).toEqual([1, 1, 1, 1, 0, 0, 0, 0])
      })
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
      const wall = vi.spyOn(wallModule, 'renderWallPreviewToFit')
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

    it('a bigger brush paints its whole square, shown at once over the last render', async () => {
      await open(flatPainting(), 'pixels')
      act(() => {
        useEditor.getState().setTool('pencil')
        useEditor.getState().setBrush(4)
        useEditor.getState().setColor([0, 0, 255, 255])
      })
      mockRect(8, 12)
      const el = surface()
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 4, clientY: 4 })
      const mask = useEditor.getState().edits?.mask
      expect(mask?.reduce((n, v) => n + v, 0)).toBe(16)
      expect([mask?.[2 * 8 + 2], mask?.[5 * 8 + 5], mask?.[6 * 8 + 6]]).toEqual([1, 1, 0])
      // The stroke preview already shows every pixel of the square, exactly as a render would.
      expect(cachedRender()?.data).toEqual(rendered().data)
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 4, clientY: 9 })
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 4, clientY: 9 })
      expect(useEditor.getState().edits?.mask.reduce((n, v) => n + v, 0)).toBe(4 * 9)
      expect(useEditor.getState().past).toHaveLength(1)
    })

    it('centres an even brush on the pointer, between the pixels nearest it', async () => {
      await open(flatPainting(), 'pixels')
      act(() => {
        useEditor.getState().setTool('pencil')
        useEditor.getState().setBrush(2)
      })
      mockRect(8, 12)
      const columns = (clientX: number) => {
        act(() => useEditor.setState({ edits: null }))
        click(clientX, 5.5)
        const mask = useEditor.getState().edits?.mask
        return [0, 1, 2, 3, 4, 5, 6, 7].filter((x) => mask?.[5 * 8 + x] === 1)
      }
      expect(columns(4.7)).toEqual([4, 5])
      expect(columns(4.2)).toEqual([3, 4])
    })

    it('[ and ] step the brush size through 1, 2, 4 and 8 px', async () => {
      await open(flatPainting(), 'pixels')
      act(() => useEditor.getState().setBrush(1))
      await userEvent.keyboard(']]')
      expect(useEditor.getState().brush).toBe(4)
      await userEvent.keyboard(']]]')
      expect(useEditor.getState().brush).toBe(8)
      await userEvent.keyboard('[[')
      expect(useEditor.getState().brush).toBe(4)
      expect(screen.getByRole('radio', { name: '4 px' })).toBeChecked()
      await userEvent.click(screen.getByRole('radio', { name: '2 px' }))
      expect(useEditor.getState().brush).toBe(2)
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

    it('sets author and colours, and includes the painting in exports with a switch (R16)', async () => {
      const p = flatPainting()
      await open(p, 'details')
      await userEvent.type(screen.getByRole('textbox', { name: 'Author' }), 'Ana')
      expect(useEditor.getState().painting?.author).toBe('Ana')
      const titleColors = screen.getByRole('radiogroup', { name: 'Title color' })
      await userEvent.click(within(titleColors).getByRole('radio', { name: 'Aqua' }))
      expect(useEditor.getState().painting?.titleColor).toBe('aqua')
      const include = screen.getByRole('switch', { name: 'Include in the next export' })
      expect(include).toBeChecked()
      expect(
        screen.getByText('Turn off to keep it as a draft, left out of exports.'),
      ).toBeInTheDocument()
      await userEvent.click(include)
      expect(useEditor.getState().painting?.status).toBe('draft')
      await userEvent.click(include)
      expect(useEditor.getState().painting?.status).toBe('ready')
    })

    it('shows the id the painting will have, following the title (R17)', async () => {
      const p = flatPainting()
      await open(p, 'details')
      const suffix = p.id.slice(-3)
      const idLine = () => screen.getByText('Will be').parentElement as HTMLElement
      expect(within(idLine()).getByText(p.id)).toBeInTheDocument()
      const input = screen.getByRole('textbox', { name: 'Title' })
      await userEvent.clear(input)
      await userEvent.type(input, 'Rosace du soir')
      expect(within(idLine()).getByText(`rosace_du_soir_${suffix}`)).toBeInTheDocument()
    })

    it('says a published painting keeps its id, size and place for good', async () => {
      const p = flatPainting({ status: 'published', publishedIn: 1 })
      await open(p, 'details')
      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
      expect(
        screen.getByText("Published: its size can't change and it can't be deleted."),
      ).toBeInTheDocument()
      const idLine = screen.getByText(p.id).parentElement as HTMLElement
      expect(idLine).toHaveTextContent(`${p.id} · never changes`)
    })

    it('labels the chosen colours with French punctuation in French', async () => {
      useLanguage.setState({ language: 'fr' })
      await open(flatPainting({ titleColor: 'yellow' }), 'details')
      const group = screen.getByRole('radiogroup', { name: 'Couleur du titre' })
      expect(group.previousElementSibling?.textContent).toBe('Couleur du titre : Jaune')
    })
  })

  describe('Size & crop', () => {
    it('keeps an invalid custom resolution as typed and says what fits (M15)', async () => {
      await open(flatPainting(), 'size')
      await userEvent.click(screen.getByRole('radio', { name: 'Custom' }))
      const input = screen.getByRole('spinbutton', { name: 'Custom pixels per block' })
      await userEvent.clear(input)
      await userEvent.type(input, '200')
      await userEvent.tab()
      expect(input).toHaveValue(200)
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByText('From 1 to 64')).toBeInTheDocument()
      expect(useEditor.getState().painting?.pixelsPerBlock).toBe(4)
      await userEvent.clear(input)
      await userEvent.type(input, '24{Enter}')
      expect(useEditor.getState().painting?.pixelsPerBlock).toBe(24)
      expect(screen.queryByText('From 1 to 64')).not.toBeInTheDocument()
    })

    it('the wheel over the crop box zooms only once the crop frame was clicked (I23)', async () => {
      await open(flatPainting(), 'size')
      const frame = screen.getByRole('group', { name: /^Crop area/ })
      const before = recipe()?.crop
      fireEvent.wheel(frame, { deltaY: -100 })
      expect(recipe()?.crop).toEqual(before)
      fireEvent.pointerDown(frame, { button: 0, pointerId: 1 })
      fireEvent.pointerUp(frame, { pointerId: 1 })
      fireEvent.wheel(frame, { deltaY: -100 })
      expect(recipe()?.crop.width).toBeLessThan(before?.width ?? 0)
    })

    it('pinching the crop frame apart zooms in, as one undo step', async () => {
      const big = flatPainting({
        recipe: { ...flatPainting().recipe, source: { imageId: 'pic', width: 8, height: 12 } },
      })
      await open(big, 'size', { assets: { pic: encodePng(createRaster(80, 120, RED)) } })
      const frame = screen.getByRole('group', { name: /^Crop area/ })
      const before = recipe()?.crop.width ?? 0
      const steps = useEditor.getState().past.length
      fireEvent.pointerDown(frame, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
      fireEvent.pointerDown(frame, { button: 0, pointerId: 2, clientX: 110, clientY: 100 })
      fireEvent.pointerMove(frame, { pointerId: 2, clientX: 120, clientY: 100 })
      fireEvent.pointerMove(frame, { pointerId: 2, clientX: 130, clientY: 100 })
      fireEvent.pointerUp(frame, { pointerId: 2 })
      fireEvent.pointerUp(frame, { pointerId: 1 })
      expect(recipe()?.crop.width).toBeLessThan(before)
      expect(useEditor.getState().past.length).toBe(steps + 1)
    })

    it('tells touch players to pinch (I23)', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query === '(pointer: coarse)',
        media: query,
      }))
      await open(flatPainting(), 'size')
      expect(screen.getByText('Drag to move, pinch to zoom.')).toBeInTheDocument()
      vi.unstubAllGlobals()
    })
  })

  describe('Step rail (I6)', () => {
    const mark = (name: RegExp) =>
      within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', { name })

    it('checks only the steps that are really done', async () => {
      await open(flatPainting({ title: '' }), 'details')
      // The picture is there; size (2×3 at 4 px) was chosen; the window is none at 0 px.
      expect(mark(/Image/)).toHaveAttribute('data-done')
      expect(mark(/Size & crop/)).toHaveAttribute('data-done')
      expect(mark(/Window & frame/)).toHaveAttribute('data-done')
      expect(mark(/Colors & pixels/)).not.toHaveAttribute('data-done')
      expect(mark(/Details/)).not.toHaveAttribute('data-done')
      await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'Night')
      expect(mark(/Details/)).toHaveAttribute('data-done')
    })

    it('does not check Size just because a picture got its centred crop', async () => {
      const p = createPainting({}, now, () => 0.5)
      const withPicture = {
        ...p,
        recipe: {
          ...p.recipe,
          source: { imageId: 'pic', width: 8, height: 12 },
          crop: { x: 0, y: 2, width: 8, height: 8 },
        },
      }
      await open(withPicture, 'details')
      expect(mark(/Image/)).toHaveAttribute('data-done')
      expect(mark(/Size & crop/)).not.toHaveAttribute('data-done')
    })

    it('marks a new painting without a picture as needing one, and nothing as done', async () => {
      const p = createPainting({}, now, () => 0.5)
      await open(p, 'details')
      expect(mark(/Image/)).toHaveAttribute('data-needed')
      expect(mark(/Image/)).toHaveAccessibleName(/no picture yet/)
      for (const name of [/Image/, /Size/, /Window/, /pixels/, /Details/]) {
        expect(mark(name)).not.toHaveAttribute('data-done')
      }
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
