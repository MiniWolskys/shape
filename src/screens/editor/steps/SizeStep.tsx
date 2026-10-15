import { useId, useState } from 'react'
import { canResize } from '../../../domain/library.ts'
import { useT } from '../../../i18n/i18n.ts'
import { isEmptyLayer } from '../../../imaging/edits.ts'
import { useEditor } from '../../../state/editor.ts'
import { Button } from '../../../ui/Button.tsx'
import { Dialog } from '../../../ui/Dialog.tsx'
import { errorMessage } from '../../../ui/errors.ts'
import { Icon } from '../../../ui/Icon.tsx'
import { Segmented } from '../../../ui/Segmented.tsx'
import { toast } from '../../../ui/toastStore.ts'
import { BlockGridPicker } from '../BlockGridPicker.tsx'
import { CropBox } from '../CropBox.tsx'
import styles from './steps.module.css'

const PRESETS: Array<[number, number]> = [
  [1, 1],
  [1, 2],
  [2, 1],
  [2, 2],
  [4, 2],
  [4, 3],
  [4, 4],
]
const RESOLUTIONS = ['16', '32', '64'] as const
type Resolution = (typeof RESOLUTIONS)[number] | 'custom'

interface Size {
  width: number
  height: number
  ppb: number
}

export function SizeStep() {
  const t = useT()
  const painting = useEditor((s) => s.painting)
  const lockedId = useId()
  const [customMode, setCustomMode] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [pending, setPending] = useState<Size | null>(null)
  if (!painting) return null

  const { width, height, pixelsPerBlock: ppb } = painting
  const locked = !canResize(painting)
  const resolution: Resolution =
    customMode || !(RESOLUTIONS as readonly string[]).includes(String(ppb))
      ? 'custom'
      : (String(ppb) as Resolution)

  function apply(size: Size) {
    try {
      useEditor.getState().resize(size.width, size.height, size.ppb)
    } catch (error) {
      toast(errorMessage(error, t), 'error')
    }
  }

  /** Pixel edits get stretched by a resize, so that asks first. */
  function requestResize(size: Size) {
    if (size.width === width && size.height === height && size.ppb === ppb) return
    const { edits } = useEditor.getState()
    if (edits && !isEmptyLayer(edits)) setPending(size)
    else apply(size)
  }

  function commitCustom() {
    if (draft === null) return
    const value = Number.parseInt(draft, 10)
    setDraft(null)
    if (Number.isFinite(value))
      requestResize({ width, height, ppb: Math.min(64, Math.max(1, value)) })
  }

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.heading}>{t.editor.size.heading}</h2>
        <BlockGridPicker
          width={width}
          height={height}
          disabled={locked}
          describedBy={locked ? lockedId : undefined}
          onPick={(w, h) => requestResize({ width: w, height: h, ppb })}
        />
        {locked && (
          <p id={lockedId} className={styles.locked}>
            <Icon name="lock" />
            {t.editor.size.locked}
          </p>
        )}
        <div className={styles.presets} role="group" aria-label={t.editor.size.presets}>
          {PRESETS.map(([w, h]) => (
            <button
              key={`${w}x${h}`}
              type="button"
              className={styles.preset}
              disabled={locked}
              aria-pressed={w === width && h === height}
              onClick={() => requestResize({ width: w, height: h, ppb })}
            >
              {`${w}×${h}`}
            </button>
          ))}
        </div>
      </section>

      <hr className={styles.separator} />

      <section className={styles.section} aria-labelledby="size-resolution">
        <h3 id="size-resolution" className={styles.subheading}>
          {t.editor.size.resolution}
        </h3>
        <div className={styles.row}>
          <Segmented<Resolution>
            label={t.editor.size.resolution}
            options={[
              ...RESOLUTIONS.map((r) => ({ value: r, label: r })),
              { value: 'custom' as const, label: t.editor.size.custom },
            ]}
            value={resolution}
            onChange={(r) => {
              if (r === 'custom') {
                setCustomMode(true)
                return
              }
              setCustomMode(false)
              requestResize({ width, height, ppb: Number(r) })
            }}
          />
          {resolution === 'custom' && (
            <input
              type="number"
              className={styles.number}
              min={1}
              max={64}
              step={1}
              aria-label={t.editor.size.customValue}
              value={draft ?? String(ppb)}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onBlur={commitCustom}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitCustom()
              }}
            />
          )}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="size-scaling">
        <h3 id="size-scaling" className={styles.subheading}>
          {t.editor.size.scaling}
        </h3>
        <Segmented
          label={t.editor.size.scaling}
          options={[
            { value: 'sharp', label: t.editor.size.sharp },
            { value: 'smooth', label: t.editor.size.smooth },
          ]}
          value={painting.recipe.scaling}
          onChange={(scaling) =>
            useEditor.getState().change((p) => ({ ...p, recipe: { ...p.recipe, scaling } }))
          }
        />
      </section>

      <hr className={styles.separator} />

      <section className={styles.section} aria-labelledby="size-crop">
        <h3 id="size-crop" className={styles.subheading}>
          {t.editor.size.crop}
        </h3>
        <CropBox />
      </section>

      <Dialog
        open={pending !== null}
        title={t.editor.size.resizeTitle}
        onClose={() => setPending(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (pending) apply(pending)
                setPending(null)
              }}
            >
              {t.editor.size.resize}
            </Button>
          </>
        }
      >
        <p className={styles.hint}>{t.editor.size.resizeBody}</p>
      </Dialog>
    </>
  )
}
