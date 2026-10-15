import { useT } from '../../i18n/i18n.ts'
import { EDITOR_STEPS, useEditor } from '../../state/editor.ts'
import { Icon } from '../../ui/Icon.tsx'
import styles from './StepRail.module.css'

/** The five steps; every one is clickable at any time. Earlier steps show a check. */
export function StepRail() {
  const t = useT()
  const step = useEditor((s) => s.step)
  const setStep = useEditor((s) => s.setStep)
  const current = EDITOR_STEPS.indexOf(step)

  return (
    <nav className={styles.rail} aria-label={t.editor.stepsLabel}>
      <ol className={styles.list}>
        {EDITOR_STEPS.map((s, index) => {
          const done = index < current
          return (
            <li key={s}>
              <button
                type="button"
                className={styles.step}
                aria-current={s === step ? 'step' : undefined}
                data-done={done || undefined}
                onClick={() => setStep(s)}
              >
                <span className={styles.badge}>
                  {done ? (
                    <>
                      <Icon name="check" size={13} />
                      <span className="visually-hidden">{index + 1}</span>
                    </>
                  ) : (
                    index + 1
                  )}
                </span>
                {t.editor.steps[s]}
              </button>
            </li>
          )
        })}
      </ol>
      <p className={styles.hint}>{t.editor.stepsHint}</p>
    </nav>
  )
}
