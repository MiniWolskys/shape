import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import styles from './Dialog.module.css'

interface DialogProps {
  open: boolean
  title: string
  onClose(): void
  children: ReactNode
  actions: ReactNode
}

const FIELDS = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
const FOCUSABLE = `${FIELDS}, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])`

/** Modal dialog on the native <dialog>; Escape asks the owner to close it. */
export function Dialog({ open, title, onClose, children, actions }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  // What the owner last asked for; a native close only needs reporting while it says open.
  const wantsOpen = useRef(open)
  useEffect(() => {
    wantsOpen.current = open
  }, [open])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      const first =
        dialog.querySelector<HTMLElement>(FIELDS) ?? dialog.querySelector<HTMLElement>(FOCUSABLE)
      first?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
    // Stops the browser closing the dialog itself: `open` stays the source of truth.
    event.preventDefault()
    onClose()
  }

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={() => {
        // The browser closed it (e.g. a form with method="dialog"): tell the owner once.
        if (!wantsOpen.current) return
        wantsOpen.current = false
        onClose()
      }}
    >
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      <div className={styles.body}>{children}</div>
      <div className={styles.actions}>{actions}</div>
    </dialog>
  )
}
