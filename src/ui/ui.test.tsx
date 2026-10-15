import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createRaster } from '../imaging/raster.ts'
import { useLanguage } from '../i18n/i18n.ts'
import { useNavigation } from '../state/navigation.ts'
import { autoBackdrop } from './backdrop.ts'
import { Button } from './Button.tsx'
import { Dialog } from './Dialog.tsx'
import { downloadBytes } from './download.ts'
import { FileDrop, WindowFileDrop } from './FileDrop.tsx'
import { LanguageSwitch } from './LanguageSwitch.tsx'
import { PaintingCanvas } from './PaintingCanvas.tsx'
import { Segmented } from './Segmented.tsx'
import { Slider } from './Slider.tsx'
import { toast, useToasts } from './toastStore.ts'
import { Toasts } from './Toasts.tsx'
import { TopBar } from './TopBar.tsx'
import { NARROW } from './useMediaQuery.ts'
import { stubMedia } from '../test/media.ts'

type View = 'edit' | 'wall' | 'nomod'

function SegmentedHarness({ onChange }: { onChange(v: View): void }) {
  const [value, setValue] = useState<View>('edit')
  return (
    <Segmented<View>
      label="View"
      options={[
        { value: 'edit', label: 'Editor' },
        { value: 'wall', label: 'On the wall' },
        { value: 'nomod', label: 'Without the mod' },
      ]}
      value={value}
      onChange={(v) => {
        onChange(v)
        setValue(v)
      }}
    />
  )
}

describe('Segmented', () => {
  it('is a radio group and changes value on click', async () => {
    const onChange = vi.fn()
    render(<SegmentedHarness onChange={onChange} />)
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Editor' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'On the wall' }))
    expect(onChange).toHaveBeenLastCalledWith('wall')
    expect(screen.getByRole('radio', { name: 'On the wall' })).toBeChecked()
  })

  it('moves the selection and focus with arrow keys, wrapping around', async () => {
    const onChange = vi.fn()
    render(<SegmentedHarness onChange={onChange} />)
    screen.getByRole('radio', { name: 'Editor' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('wall')
    expect(screen.getByRole('radio', { name: 'On the wall' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('edit')
    await userEvent.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('nomod')
  })

  it('does not report a change when the selected option is clicked again', async () => {
    const onChange = vi.fn()
    render(<SegmentedHarness onChange={onChange} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Editor' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('only the selected option is in the tab order', () => {
    render(<SegmentedHarness onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Editor' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'On the wall' })).toHaveAttribute('tabindex', '-1')
  })
})

describe('Slider', () => {
  function Harness(props: { initial?: number; onChange?: (v: number) => void }) {
    const [value, setValue] = useState(props.initial ?? 4)
    return (
      <Slider
        id="thickness"
        label="Frame thickness"
        min={0}
        max={8}
        value={value}
        defaultValue={2}
        unit="px"
        onChange={(v) => {
          props.onChange?.(v)
          setValue(v)
        }}
      />
    )
  }

  it('shows the value with its unit and reports changes as numbers', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    expect(screen.getByRole('spinbutton', { name: 'Frame thickness (px)' })).toHaveValue(4)
    expect(screen.getByText('px')).toBeInTheDocument()
    const input = screen.getByRole('slider', { name: 'Frame thickness' })
    fireEvent.change(input, { target: { value: '6' } })
    expect(onChange).toHaveBeenCalledWith(6)
    expect(screen.getByRole('spinbutton', { name: 'Frame thickness (px)' })).toHaveValue(6)
  })

  it('shows the bare value without a unit', () => {
    render(<Slider id="s" label="Size" min={1} max={16} value={3} onChange={() => {}} />)
    expect(screen.getByRole('spinbutton', { name: 'Size' })).toHaveValue(3)
  })

  it('takes an exact value typed in its number field on Enter or leaving it, in range', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const field = screen.getByRole('spinbutton', { name: 'Frame thickness (px)' })
    await userEvent.clear(field)
    await userEvent.type(field, '7')
    // Nothing changes while typing: one value, one undo step.
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith(7)
    await userEvent.clear(field)
    await userEvent.type(field, '50')
    await userEvent.tab()
    expect(onChange).toHaveBeenLastCalledWith(8)
    expect(field).toHaveValue(8)
    // An empty field goes back to the value on blur, without a change.
    onChange.mockClear()
    await userEvent.clear(field)
    await userEvent.tab()
    expect(onChange).not.toHaveBeenCalled()
    expect(field).toHaveValue(8)
  })

  it('a double-click on the label or the slider puts the default back', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.dblClick(screen.getByText('Frame thickness'))
    expect(onChange).toHaveBeenLastCalledWith(2)
    fireEvent.change(screen.getByRole('slider', { name: 'Frame thickness' }), {
      target: { value: '5' },
    })
    fireEvent.doubleClick(screen.getByRole('slider', { name: 'Frame thickness' }))
    expect(onChange).toHaveBeenLastCalledWith(2)
    expect(screen.getByRole('slider', { name: 'Frame thickness' })).toHaveValue('2')
  })
})

describe('Dialog', () => {
  it('opens modally, focuses the first field and calls onClose on Escape', async () => {
    const onClose = vi.fn()
    render(
      <Dialog open title="Rename" onClose={onClose} actions={<Button>Save</Button>}>
        <input aria-label="Name" />
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Rename' })
    expect(dialog).toHaveAttribute('open')
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when open becomes false, without calling onClose', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Dialog open title="Rename" onClose={onClose} actions={null}>
        body
      </Dialog>,
    )
    rerender(
      <Dialog open={false} title="Rename" onClose={onClose} actions={null}>
        body
      </Dialog>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose once when the browser closes the dialog itself', () => {
    const onClose = vi.fn()
    render(
      <Dialog open title="Rename" onClose={onClose} actions={null}>
        body
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Rename' }) as HTMLDialogElement
    act(() => dialog.close())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores Escape while an input method is composing', () => {
    const onClose = vi.fn()
    render(
      <Dialog open title="Rename" onClose={onClose} actions={null}>
        <input aria-label="Name" />
      </Dialog>,
    )
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), {
      key: 'Escape',
      isComposing: true,
    })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('autoBackdrop', () => {
  it('uses light behind dark frames and no frame, dark behind light frames', () => {
    expect(autoBackdrop('dark_oak')).toBe('light')
    expect(autoBackdrop('none')).toBe('light')
    expect(autoBackdrop('spruce')).toBe('light')
    expect(autoBackdrop('birch')).toBe('dark')
    expect(autoBackdrop('iron')).toBe('dark')
  })
})

describe('PaintingCanvas', () => {
  it('renders a canvas sized to the raster and draws its pixels', () => {
    const putImageData = vi.fn()
    const createImageData = vi.fn((w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    }))
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(
        () => ({ putImageData, createImageData }) as unknown as CanvasRenderingContext2D,
      )
    try {
      const raster = createRaster(3, 2, [10, 20, 30, 255])
      render(<PaintingCanvas raster={raster} scale={4} label="Sunset Chapel" backdrop="light" />)
      const canvas = screen.getByRole('img', { name: 'Sunset Chapel' })
      expect(canvas.tagName).toBe('CANVAS')
      expect(canvas).toHaveAttribute('width', '3')
      expect(canvas).toHaveAttribute('height', '2')
      expect(canvas.style.width).toBe('12px')
      expect(canvas.style.height).toBe('8px')
      expect(putImageData).toHaveBeenCalledTimes(1)
      const image = putImageData.mock.calls[0]?.[0] as { data: Uint8ClampedArray }
      expect(Array.from(image.data.slice(0, 4))).toEqual([10, 20, 30, 255])
    } finally {
      getContext.mockRestore()
    }
  })

  it('draws only the changed area of the same pixels, without copying them', () => {
    const putImageData = vi.fn()
    class FakeImageData {
      readonly data: Uint8ClampedArray
      readonly width: number
      readonly height: number
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data
        this.width = width
        this.height = height
      }
    }
    vi.stubGlobal('ImageData', FakeImageData)
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => ({ putImageData }) as unknown as CanvasRenderingContext2D)
    try {
      const raster = createRaster(8, 4, [10, 20, 30, 255])
      const onDrawn = vi.fn()
      const view = render(<PaintingCanvas raster={raster} label="P" onDrawn={onDrawn} />)
      expect(putImageData).toHaveBeenLastCalledWith(expect.any(FakeImageData), 0, 0)
      const image = putImageData.mock.calls[0]?.[0] as FakeImageData
      // The canvas reads the raster's own pixels.
      expect(image.data).toBe(raster.data)
      expect(onDrawn).toHaveBeenCalledTimes(1)
      // The same pixels, changed in a box: only that box is drawn.
      const box = { x0: 1, y0: 2, x1: 3, y1: 3 }
      view.rerender(
        <PaintingCanvas raster={{ ...raster }} dirty={box} label="P" onDrawn={onDrawn} />,
      )
      expect(putImageData).toHaveBeenLastCalledWith(image, 0, 0, 1, 2, 3, 2)
      expect(onDrawn).toHaveBeenCalledTimes(2)
      // New pixels are drawn whole, whatever the box says.
      const next = createRaster(8, 4)
      view.rerender(<PaintingCanvas raster={next} dirty={box} label="P" onDrawn={onDrawn} />)
      const last = putImageData.mock.lastCall ?? []
      expect(last).toHaveLength(3)
      expect((last[0] as FakeImageData).data).toBe(next.data)
    } finally {
      getContext.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('fits within a box using an integer scale when it can', () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => null)
    try {
      render(
        <PaintingCanvas
          raster={createRaster(16, 32)}
          fit={{ width: 100, height: 100 }}
          label="Tall"
        />,
      )
      // 100/32 = 3.125 → 3
      expect(screen.getByRole('img', { name: 'Tall' }).style.height).toBe('96px')
      render(
        <PaintingCanvas
          raster={createRaster(64, 32)}
          fit={{ width: 32, height: 32 }}
          label="Big"
        />,
      )
      expect(screen.getByRole('img', { name: 'Big' }).style.width).toBe('32px')
    } finally {
      getContext.mockRestore()
    }
  })
})

describe('Toasts', () => {
  afterEach(() => {
    vi.useRealTimers()
    useToasts.setState({ toasts: [] })
  })

  it('announces info politely and errors at once (M1); info goes after 4 s, errors after 8 s', () => {
    vi.useFakeTimers()
    render(<Toasts />)
    const polite = screen.getByRole('status')
    expect(polite).toHaveAttribute('aria-live', 'polite')
    const urgent = screen.getByRole('alert')
    act(() => {
      toast('Saved')
      toast('Export failed', 'error')
    })
    expect(within(polite).getByText('Saved')).toBeInTheDocument()
    expect(within(urgent).getByText('Export failed')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(4000))
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    expect(screen.getByText('Export failed')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(4000))
    expect(screen.queryByText('Export failed')).not.toBeInTheDocument()
  })

  it('sits over the painting in the editor, clear of the inspector (M1)', () => {
    useNavigation.setState({ screen: { name: 'editor', paintingId: 'rose_abc' } })
    const { container } = render(<Toasts />)
    expect(container.firstElementChild).toHaveAttribute('data-area', 'stage')
    useNavigation.setState({ screen: { name: 'library' } })
  })

  it('offers an action button that runs once and closes the toast; it stays 8 s', async () => {
    vi.useFakeTimers()
    render(<Toasts />)
    const run = vi.fn()
    act(() => toast('Crop recentred', 'info', { label: 'Undo', run }))
    act(() => vi.advanceTimersByTime(4000))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(run).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Crop recentred')).not.toBeInTheDocument()
  })
})

describe('TopBar', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    act(() => useLanguage.getState().setLanguage('en'))
  })

  function renderBar(onImport = vi.fn()) {
    render(
      <TopBar
        menu={[{ label: 'Import', onSelect: onImport }]}
        right={<button type="button">Export</button>}
      />,
    )
    return onImport
  }

  it('shows secondary actions and the language switch in the bar on wide screens', async () => {
    const onImport = renderBar()
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument()
  })

  it('folds them into a "⋯" menu on narrow screens, keeping the main action (I24)', async () => {
    stubMedia([NARROW])
    const onImport = renderBar()
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Language' })).not.toBeInTheDocument()

    const more = screen.getByRole('button', { name: 'More actions' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Import' }))
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await userEvent.click(more)
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Français' }))
    expect(useLanguage.getState().language).toBe('fr')
  })

  it('closes the menu with Escape or a click elsewhere', async () => {
    stubMedia([NARROW])
    renderBar()
    const more = screen.getByRole('button', { name: 'More actions' })
    await userEvent.click(more)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(more).toHaveFocus()
    await userEvent.click(more)
    await userEvent.click(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('LanguageSwitch', () => {
  it('marks the active language and switches it', async () => {
    act(() => useLanguage.getState().setLanguage('en'))
    render(<LanguageSwitch />)
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'FR' }))
    expect(useLanguage.getState().language).toBe('fr')
    expect(screen.getByRole('button', { name: 'FR' })).toHaveAttribute('aria-pressed', 'true')
    act(() => useLanguage.getState().setLanguage('en'))
  })
})

describe('FileDrop', () => {
  it('passes dropped files that match accept', () => {
    const onFiles = vi.fn()
    render(
      <FileDrop accept="image/*,.zip" onFiles={onFiles}>
        <p>Drop here</p>
      </FileDrop>,
    )
    const png = new File(['x'], 'a.png', { type: 'image/png' })
    const zip = new File(['x'], 'pack.ZIP', { type: '' })
    const txt = new File(['x'], 'notes.txt', { type: 'text/plain' })
    fireEvent.drop(screen.getByText('Drop here'), {
      dataTransfer: { files: [png, zip, txt], types: ['Files'] },
    })
    expect(onFiles).toHaveBeenCalledWith([png, zip])
  })

  function renderBoth(label: (types: readonly string[]) => string = () => 'Drop it') {
    const full = vi.fn()
    const local = vi.fn()
    render(
      <>
        <WindowFileDrop label={label} blockedLabel="Close the dialog first" onFiles={full} />
        <p>Page</p>
        <FileDrop accept="image/*" onFiles={local}>
          <button type="button">Local zone</button>
        </FileDrop>
      </>,
    )
    return { full, local }
  }
  const overlay = () => document.querySelector('[data-drop-overlay]')
  const png = () => new File(['x'], 'a.png', { type: 'image/png' })

  it('delivers a drop on a local zone once, to that zone, and clears the window overlay', () => {
    const { full, local } = renderBoth()
    const zone = screen.getByText('Local zone')
    fireEvent.dragEnter(zone, { dataTransfer: { files: [], types: ['Files'] } })
    expect(overlay()).not.toBeNull()
    const file = png()
    fireEvent.drop(zone, { dataTransfer: { files: [file], types: ['Files'] } })
    expect(local).toHaveBeenCalledTimes(1)
    expect(local).toHaveBeenCalledWith([file])
    expect(full).not.toHaveBeenCalled()
    expect(overlay()).toBeNull()
  })

  it('delivers any file dropped elsewhere to the window handler, and keeps the page (C4)', () => {
    const { full, local } = renderBoth()
    const page = screen.getByText('Page')
    fireEvent.dragEnter(page, { dataTransfer: { files: [], types: ['Files'] } })
    const over = createEvent.dragOver(page, { dataTransfer: { files: [], types: ['Files'] } })
    fireEvent(page, over)
    expect(over.defaultPrevented).toBe(true)
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
    const drop = createEvent.drop(page, { dataTransfer: { files: [file], types: ['Files'] } })
    fireEvent(page, drop)
    // The browser never opens the file in place of the app.
    expect(drop.defaultPrevented).toBe(true)
    expect(full).toHaveBeenCalledTimes(1)
    expect(full).toHaveBeenCalledWith([file])
    expect(local).not.toHaveBeenCalled()
    expect(overlay()).toBeNull()
  })

  it('labels the overlay with what the drop will do, from the dragged types', () => {
    renderBoth((types) => `Will take ${types.join(',') || 'anything'}`)
    fireEvent.dragEnter(screen.getByText('Page'), {
      dataTransfer: {
        files: [],
        types: ['Files'],
        items: [{ kind: 'file', type: 'image/png' }],
      },
    })
    expect(overlay()).toHaveTextContent('Will take image/png')
  })

  it('leaves drags of text and links alone', () => {
    const { full } = renderBoth()
    const page = screen.getByText('Page')
    fireEvent.dragEnter(page, { dataTransfer: { types: ['text/plain'] } })
    expect(overlay()).toBeNull()
    const drop = createEvent.drop(page, { dataTransfer: { types: ['text/plain'] } })
    fireEvent(page, drop)
    expect(drop.defaultPrevented).toBe(false)
    expect(full).not.toHaveBeenCalled()
  })

  it('keeps files from the browser but takes none while a dialog is open', () => {
    const { full } = renderBoth(() => 'Drop it')
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.append(dialog)
    try {
      const page = screen.getByText('Page')
      fireEvent.dragEnter(page, { dataTransfer: { files: [], types: ['Files'] } })
      expect(overlay()).toHaveTextContent('Close the dialog first')
      const drop = createEvent.drop(page, { dataTransfer: { files: [png()], types: ['Files'] } })
      fireEvent(page, drop)
      expect(drop.defaultPrevented).toBe(true)
      fireEvent.paste(document.body, { clipboardData: { files: [png()] } })
      expect(full).not.toHaveBeenCalled()
    } finally {
      dialog.remove()
    }
  })

  it('clears the overlay when the drag ends without a drop', () => {
    renderBoth()
    fireEvent.dragEnter(screen.getByText('Page'), { dataTransfer: { files: [], types: ['Files'] } })
    expect(overlay()).not.toBeNull()
    fireEvent.dragEnd(screen.getByText('Page'))
    expect(overlay()).toBeNull()
  })

  it('gives a pasted file to the window handler unless focus is inside a local zone', () => {
    const { full, local } = renderBoth()
    const first = png()
    fireEvent.paste(document.body, { clipboardData: { files: [first] } })
    expect(full).toHaveBeenCalledWith([first])
    expect(local).not.toHaveBeenCalled()

    const button = screen.getByRole('button', { name: 'Local zone' })
    button.focus()
    const second = png()
    fireEvent.paste(button, { clipboardData: { files: [second] } })
    expect(local).toHaveBeenCalledWith([second])
    expect(full).toHaveBeenCalledTimes(1)
  })

  it('ignores pastes into editable content and pastes without files', () => {
    const { full } = renderBoth()
    const editable = screen.getByText('Page')
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    fireEvent.paste(editable, { clipboardData: { files: [png()] } })
    fireEvent.paste(document.body, { clipboardData: { files: [] } })
    expect(full).not.toHaveBeenCalled()
  })
})

describe('downloadBytes', () => {
  it('clicks a link to an object URL and revokes it afterwards', () => {
    vi.useFakeTimers()
    const create = vi.fn(() => 'blob:fake')
    const revoke = vi.fn()
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
    URL.createObjectURL = create
    URL.revokeObjectURL = revoke
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      downloadBytes(new Uint8Array([1, 2, 3]), 'pack.zip', 'application/zip')
      expect(click).toHaveBeenCalledTimes(1)
      const anchor = click.mock.contexts[0] as HTMLAnchorElement
      expect(anchor.download).toBe('pack.zip')
      expect(anchor.isConnected).toBe(false)
      vi.advanceTimersByTime(9_999)
      expect(revoke).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(revoke).toHaveBeenCalledWith('blob:fake')
    } finally {
      click.mockRestore()
      URL.createObjectURL = original.create
      URL.revokeObjectURL = original.revoke
      vi.useRealTimers()
    }
  })
})
