import { format, plural, useT } from '../i18n/i18n.ts'
import { useNavigation } from '../state/navigation.ts'
import { useWorkspace } from '../state/workspace.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import styles from './CloseLibraryDialog.module.css'

interface CloseLibraryDialogProps {
  open: boolean
  onCancel(): void
  /** Close (or replace) the open library now. */
  onConfirm(): void
  /** The plain confirm's label when nothing would be lost, e.g. "Close it and create". */
  confirmLabel?: string
}

/**
 * Asks before the open library is closed or replaced (R15). It names how many paintings no
 * downloaded pack holds: those are deleted, so "Export first" is the main way out and deleting
 * is a danger action labelled by its effect. When nothing would be lost it is a plain confirm.
 */
export function CloseLibraryDialog({
  open,
  onCancel,
  onConfirm,
  confirmLabel,
}: CloseLibraryDialogProps) {
  const t = useT()
  const go = useNavigation((s) => s.go)
  const library = useWorkspace((s) => s.library)
  const demo = useWorkspace((s) => s.demo)
  const count = useWorkspace((s) => (s.library ? s.unexportedCount() : 0))
  if (!library) return null

  const name = library.name
  let message: string
  if (count > 0) {
    message = demo
      ? plural(t, t.closeLibrary.demoChanged, count)
      : plural(t, t.closeLibrary.unexported, count, { name })
  } else if (demo) {
    message = t.closeLibrary.demoSafe
  } else if (library.paintings.length === 0) {
    message = format(t.closeLibrary.empty, { name })
  } else {
    message = format(t.closeLibrary.safe, {
      name,
      file: `${library.namespace}-v${library.version}.zip`,
    })
  }

  function exportFirst() {
    onCancel()
    go({ name: 'export' })
  }

  return (
    <Dialog
      open={open}
      title={format(t.closeLibrary.title, { name })}
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t.common.cancel}
          </Button>
          {count > 0 ? (
            <>
              <Button variant="danger" onClick={onConfirm}>
                {plural(t, t.closeLibrary.deleteAndClose, count)}
              </Button>
              {/* The demo can't be exported (R23): there, deleting is the only way on. */}
              {!demo && (
                <Button variant="primary" onClick={exportFirst}>
                  {t.closeLibrary.exportFirst}
                </Button>
              )}
            </>
          ) : (
            <Button variant="primary" onClick={onConfirm}>
              {confirmLabel ?? t.library.closeLibrary}
            </Button>
          )}
        </>
      }
    >
      <p className={count > 0 ? styles.danger : styles.text}>{message}</p>
    </Dialog>
  )
}
