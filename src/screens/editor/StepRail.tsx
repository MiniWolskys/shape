import { defaultRecipe } from '../../domain/library.ts'
import type { Painting } from '../../domain/types.ts'
import { format, useT } from '../../i18n/i18n.ts'
import type { EditLayer } from '../../imaging/edits.ts'
import { EDITOR_STEPS, useEditor, type EditorStep } from '../../state/editor.ts'
import { Icon } from '../../ui/Icon.tsx'
import { NARROW, useMediaQuery } from '../../ui/useMediaQuery.ts'
import styles from './StepRail.module.css'

const DEFAULT = defaultRecipe()
const DEFAULT_PPB = 32

/**
 * Which steps hold a real choice (I6), read from the painting itself: a picture, a size other
 * than a new painting's, a window or frame other than the default, pixel edits, a title.
 */
function doneSteps(p: Painting, edits: EditLayer | null): Record<EditorStep, boolean> {
  const { recipe } = p
  return {
    image: recipe.source !== null,
    // A new painting is 1×1 at 32 px until the player or a first picture (R20) sizes it.
    size: p.width !== 1 || p.height !== 1 || p.pixelsPerBlock !== DEFAULT_PPB,
    window:
      recipe.window.shape !== DEFAULT.window.shape ||
      recipe.window.glassOpacity !== DEFAULT.window.glassOpacity ||
      recipe.frame.material !== DEFAULT.frame.material ||
      recipe.frame.thickness !== DEFAULT.frame.thickness,
    pixels: edits !== null || recipe.editsId !== null,
    details: p.title.trim() !== '',
  }
}

/**
 * The five steps; every one is clickable at any time. A step shows a check once it holds a real
 * choice, and Image a warning dot while there is no picture.
 */
export function StepRail() {
  const t = useT()
  const step = useEditor((s) => s.step)
  const painting = useEditor((s) => s.painting)
  const edits = useEditor((s) => s.edits)
  const setStep = useEditor((s) => s.setStep)
  const narrow = useMediaQuery(NARROW)
  if (!painting) return null
  const done = doneSteps(painting, edits)

  if (narrow) {
    // Phones: one line, "Step 2 of 5 · Size & crop ▾", instead of a rail scrolling sideways.
    return (
      <div className={styles.compact}>
        <select
          className={styles.select}
          aria-label={t.editor.stepsLabel}
          value={step}
          onChange={(event) => setStep(event.target.value as EditorStep)}
        >
          {EDITOR_STEPS.map((s, index) => (
            <option key={s} value={s}>
              {format(t.editor.stepOf, {
                number: index + 1,
                total: EDITOR_STEPS.length,
                name: t.editor.steps[s],
              })}
              {done[s] ? ' ✓' : ''}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <nav className={styles.rail} aria-label={t.editor.stepsLabel}>
      <ol className={styles.list}>
        {EDITOR_STEPS.map((s, index) => {
          const needed = s === 'image' && !done.image
          return (
            <li key={s}>
              <button
                type="button"
                className={styles.step}
                aria-current={s === step ? 'step' : undefined}
                data-done={done[s] || undefined}
                data-needed={needed || undefined}
                onClick={() => setStep(s)}
              >
                <span className={styles.badge}>
                  {done[s] ? (
                    <>
                      <Icon name="check" size={13} />
                      <span className="visually-hidden">{index + 1}</span>
                    </>
                  ) : (
                    index + 1
                  )}
                </span>
                {t.editor.steps[s]}
                {needed && (
                  <>
                    <span className={styles.dot} aria-hidden="true" />
                    <span className="visually-hidden">, {t.editor.stepNeedsPicture}</span>
                  </>
                )}
              </button>
            </li>
          )
        })}
      </ol>
      <p className={styles.hint}>{t.editor.stepsHint}</p>
    </nav>
  )
}
