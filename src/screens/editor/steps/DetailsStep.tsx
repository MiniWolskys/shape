import { useId, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { retitlePainting } from '../../../domain/library.ts'
import { MC_COLOR_HEX, MC_COLORS, type McColor, type Painting } from '../../../domain/types.ts'
import { format, useT } from '../../../i18n/i18n.ts'
import { useEditor } from '../../../state/editor.ts'
import { useWorkspace } from '../../../state/workspace.ts'
import { TooltipPreview } from '../TooltipPreview.tsx'
import styles from './steps.module.css'
import own from './DetailsStep.module.css'

const MAX_TEXT = 64

/**
 * The id the painting will have once its title is saved (R17), by the rule the save uses. On a
 * clash the save draws a random suffix, so the preview may then differ from the saved id.
 */
function previewId(p: Painting, others: Painting[]): string {
  const taken = new Set(others.flatMap((q) => (q.id === p.id ? [] : [q.id])))
  return retitlePainting(p, p.title, taken, new Date(), () => 0).id
}

/** Typing merges into one undo step per field (until a pause). */
function patch(fields: Partial<Painting>, merge?: string) {
  useEditor.getState().change((p) => ({ ...p, ...fields }), { merge })
}

export function DetailsStep() {
  const t = useT()
  const id = useId()
  const painting = useEditor((s) => s.painting)
  const library = useWorkspace((s) => s.library)
  const loose = useWorkspace((s) => s.loose)
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

      <section className={styles.section} aria-labelledby={`${id}-id`}>
        {status === 'published' ? (
          <p className={styles.hint}>
            <b className={own.published}>{t.editor.details.publishedNote}</b>
          </p>
        ) : (
          <>
            <div className={styles.between}>
              <label htmlFor={`${id}-include`} className={styles.subheading}>
                {t.editor.details.include}
              </label>
              <input
                id={`${id}-include`}
                type="checkbox"
                role="switch"
                className={styles.switch}
                checked={status === 'ready'}
                aria-describedby={`${id}-include-hint`}
                onChange={(event) =>
                  patch({ status: event.currentTarget.checked ? 'ready' : 'draft' })
                }
              />
            </div>
            <p id={`${id}-include-hint`} className={styles.hint}>
              {t.editor.details.includeHint}
            </p>
          </>
        )}
        <h3 id={`${id}-id`} className={styles.subheading}>
          {t.editor.paintingId}
        </h3>
        {status === 'published' ? (
          <p className={own.idRow}>
            <code className={own.id}>{painting.id}</code>{' '}
            <span className={styles.hint}>· {t.editor.details.neverChanges}</span>
          </p>
        ) : (
          <p className={own.idRow}>
            <span className={styles.hint}>{t.editor.details.willBe}</span>
            <code className={own.id}>
              {previewId(painting, [...(library?.paintings ?? []), ...loose])}
            </code>
          </p>
        )}
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
        {format(t.editor.chosenColor, { label })}{' '}
        <span className={own.colorName}>{t.mcColors[value]}</span>
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
