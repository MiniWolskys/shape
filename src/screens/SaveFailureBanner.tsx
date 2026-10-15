import { useLayoutEffect, useRef } from 'react'
import { format, useT } from '../i18n/i18n.ts'
import { useNavigation } from '../state/navigation.ts'
import { useWorkspace } from '../state/workspace.ts'
import { Button } from '../ui/Button.tsx'
import styles from './SaveFailureBanner.module.css'

/** The banner's height, so full-height screens (the editor) leave room for it. */
const HEIGHT_VAR = '--save-banner-height'

/**
 * While saving to the browser storage fails (C1): says the work is not being saved and why,
 * with Export (when a library pack can be built) and Try again. It cannot be dismissed: it goes
 * away once a save succeeds, which the next change also tries.
 */
export function SaveFailureBanner() {
  const t = useT()
  const saveError = useWorkspace((s) => s.saveError)
  const exportable = useWorkspace((s) => s.library !== null && !s.demo)
  const onExport = useNavigation((s) => s.screen.name === 'export')
  const go = useNavigation((s) => s.go)
  const box = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = box.current
    const root = document.documentElement
    if (!element) return
    const measure = () => root.style.setProperty(HEIGHT_VAR, `${element.offsetHeight}px`)
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(element)
    return () => {
      observer?.disconnect()
      root.style.removeProperty(HEIGHT_VAR)
    }
  }, [saveError])

  if (saveError === null) return null
  const reason = saveError === 'storage-full' ? t.saveFailure.full : t.saveFailure.failed
  return (
    <div ref={box} role="alert" className={styles.banner}>
      <p className={styles.message}>{format(t.saveFailure.message, { reason })}</p>
      <div className={styles.actions}>
        {exportable && !onExport && (
          <Button variant="primary" onClick={() => go({ name: 'export' })}>
            {t.saveFailure.export}
          </Button>
        )}
        <Button onClick={() => void useWorkspace.getState().persistNow()}>
          {t.saveFailure.retry}
        </Button>
      </div>
    </div>
  )
}
