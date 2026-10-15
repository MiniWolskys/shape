import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createRaster } from '../imaging/raster.ts'
import { useLanguage } from '../i18n/i18n.ts'
import { autoBackdrop } from './backdrop.ts'
import { Button } from './Button.tsx'
import { Dialog } from './Dialog.tsx'
import { downloadBytes } from './download.ts'
import { FileDrop } from './FileDrop.tsx'
import { LanguageSwitch } from './LanguageSwitch.tsx'
import { PaintingCanvas } from './PaintingCanvas.tsx'
import { Segmented } from './Segmented.tsx'
import { Slider } from './Slider.tsx'
import { toast, useToasts } from './toastStore.ts'
import { Toasts } from './Toasts.tsx'

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

  it('only the selected option is in the tab order', () => {
    render(<SegmentedHarness onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Editor' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'On the wall' })).toHaveAttribute('tabindex', '-1')
  })
})

describe('Slider', () => {
  it('shows the value with its unit and reports changes as numbers', () => {
    const onChange = vi.fn()
    render(
      <Slider
        id="thickness"
        label="Frame thickness"
        min={0}
        max={8}
        value={4}
        unit="px"
        onChange={onChange}
      />,
    )
    expect(screen.getByText('4 px')).toBeInTheDocument()
    const input = screen.getByRole('slider', { name: 'Frame thickness' })
    fireEvent.change(input, { target: { value: '6' } })
    expect(onChange).toHaveBeenCalledWith(6)
  })

  it('shows the bare value without a unit', () => {
    render(<Slider id="s" label="Size" min={1} max={16} value={3} onChange={() => {}} />)
    expect(screen.getByText('3')).toBeInTheDocument()
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

  it('closes when open becomes false', () => {
    const { rerender } = render(
      <Dialog open title="Rename" onClose={() => {}} actions={null}>
        body
      </Dialog>,
    )
    rerender(
      <Dialog open={false} title="Rename" onClose={() => {}} actions={null}>
        body
      </Dialog>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

  it('announces toasts politely and dismisses info after 4 s, errors after 8 s', () => {
    vi.useFakeTimers()
    render(<Toasts />)
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    act(() => {
      toast('Saved')
      toast('Export failed', 'error')
    })
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.getByText('Export failed')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(4000))
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    expect(screen.getByText('Export failed')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(4000))
    expect(screen.queryByText('Export failed')).not.toBeInTheDocument()
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
      vi.runAllTimers()
      expect(revoke).toHaveBeenCalledWith('blob:fake')
    } finally {
      click.mockRestore()
      URL.createObjectURL = original.create
      URL.revokeObjectURL = original.revoke
      vi.useRealTimers()
    }
  })
})
