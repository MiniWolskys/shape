import { useId, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { MC_COLOR_HEX, MC_COLORS, type McColor, type Painting } from '../../../domain/types.ts'
import { format, useT } from '../../../i18n/i18n.ts'
import { useEditor } from '../../../state/editor.ts'
import { Segmented } from '../../../ui/Segmented.tsx'
import { TooltipPreview } from '../TooltipPreview.tsx'
import styles from './steps.module.css'
import own from './DetailsStep.module.css'

const MAX_TEXT = 64

/** Typing merges into one undo step per field (until a pause). */
function patch(fields: Partial<Painting>, merge?: string) {
  useEditor.getState().change((p) => ({ ...p, ...fields }), { merge })
}

export function DetailsStep() {
  const t = useT()
  const id = useId()
  const painting = useEditor((s) => s.painting)
  if (!painting) return null
  const { title, titleColor, author, authorColor, status } = painting
  const limit = format(t.editor.details.maxLength, { count: MAX_TEXT })

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.heading}>{t.editor.details.heading}</h2>
        <TooltipPreview
          title={title}
          titleColor={titleColor}
          author={author}
          authorColor={authorColor}
          width={painting.width}
          height={painting.height}
        />
      </section>

      <section className={styles.section}>
        <div className={own.field}>
          <label htmlFor={`${id}-title`} className={styles.subheading}>
            {t.editor.paintingTitle}
          </label>
          <input
            id={`${id}-title`}
            className={own.text}
            type="text"
            maxLength={MAX_TEXT}
            value={title}
            aria-describedby={`${id}-limit`}
            onChange={(event) => patch({ title: event.currentTarget.value }, 'details.title')}
          />
        </div>
        <McColorPicker
          label={t.editor.titleColor}
          value={titleColor}
          onChange={(c) => patch({ titleColor: c })}
        />
        <div className={own.field}>
          <label htmlFor={`${id}-author`} className={styles.subheading}>
            {t.editor.author}
          </label>
          <input
            id={`${id}-author`}
            className={own.text}
            type="text"
            maxLength={MAX_TEXT}
            value={author}
            aria-describedby={`${id}-limit`}
            onChange={(event) => patch({ author: event.currentTarget.value }, 'details.author')}
          />
        </div>
        <McColorPicker
          label={t.editor.authorColor}
          value={authorColor}
          onChange={(c) => patch({ authorColor: c })}
        />
        <p id={`${id}-limit`} className={styles.hint}>
          {limit}
        </p>
      </section>

      <hr className={styles.separator} />

      <section className={styles.section} aria-labelledby={`${id}-status`}>
        <h3 id={`${id}-status`} className={styles.subheading}>
          {t.editor.details.status}
        </h3>
        {status === 'published' ? (
          <p className={styles.hint}>
            <b className={own.published}>{t.library.status.published}</b>
            {' · '}
            {t.editor.details.publishedNote}
          </p>
        ) : (
          <Segmented
            label={t.editor.details.status}
            options={[
              { value: 'draft', label: t.library.status.draft },
              { value: 'ready', label: t.library.status.ready },
            ]}
            value={status}
            onChange={(next) => patch({ status: next })}
          />
        )}
      </section>

      <section className={styles.section} aria-labelledby={`${id}-id`}>
        <h3 id={`${id}-id`} className={styles.subheading}>
          {t.editor.paintingId}
        </h3>
        <div className={own.idRow}>
          <code className={own.id}>{painting.id}</code>
          <span className={styles.hint}>{t.editor.details.neverChanges}</span>
        </div>
      </section>
    </>
  )
}

const ARROWS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

/** The 16 Minecraft text colours as a radio group of named swatches; arrow keys move. */
function McColorPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: McColor
  onChange(c: McColor): void
}) {
  const t = useT()
  const buttons = useRef<Array<HTMLButtonElement | null>>([])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = ARROWS[event.key]
    if (step === undefined) return
    event.preventDefault()
    const count = MC_COLORS.length
    const index = (MC_COLORS.indexOf(value) + step + count) % count
    const next = MC_COLORS[index]
    if (!next) return
    onChange(next)
    buttons.current[index]?.focus()
  }

  return (
    <div className={own.field}>
      <span className={styles.subheading} aria-hidden="true">
        {label}: <span className={own.colorName}>{t.mcColors[value]}</span>
      </span>
      <div className={own.swatches} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
        {MC_COLORS.map((c, index) => (
          <button
            key={c}
            ref={(el) => {
              buttons.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={c === value}
            aria-label={t.mcColors[c]}
            title={t.mcColors[c]}
            tabIndex={c === value ? 0 : -1}
            className={own.swatch}
            style={{ '--swatch': MC_COLOR_HEX[c] } as CSSProperties}
            onClick={() => {
              if (c !== value) onChange(c)
            }}
          />
        ))}
      </div>
    </div>
  )
}
