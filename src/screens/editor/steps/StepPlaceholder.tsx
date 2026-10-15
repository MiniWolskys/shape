import { useT } from '../../../i18n/i18n.ts'
import { useEditor } from '../../../state/editor.ts'
import styles from './steps.module.css'

/** Stands in for the Window, Pixels and Details panels until they are built. */
export function StepPlaceholder() {
  const t = useT()
  const step = useEditor((s) => s.step)
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>{t.editor.steps[step]}</h2>
      <p className={styles.hint}>{t.editor.comingSoon}</p>
    </section>
  )
}
