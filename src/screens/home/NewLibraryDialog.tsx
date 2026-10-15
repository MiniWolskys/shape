import { useId, useState, type FormEvent } from 'react'
import { isValidNamespace, namespaceFromName } from '../../domain/ids.ts'
import { format, useT } from '../../i18n/i18n.ts'
import { Button } from '../../ui/Button.tsx'
import { Dialog } from '../../ui/Dialog.tsx'
import styles from './HomeScreen.module.css'

interface NewLibraryDialogProps {
  open: boolean
  /** Name of the library that creating a new one would close, if any. */
  replacing: string | null
  onClose(): void
  onCreate(name: string, namespace: string): void
}

/**
 * Asks for a library name (R22). The pack ID (namespace) follows the name; it sits under
 * "Advanced" because players rarely need it, and it can't change after the first export.
 */
export function NewLibraryDialog({ open, replacing, onClose, onCreate }: NewLibraryDialogProps) {
  const t = useT()
  const formId = useId()
  const nameId = useId()
  const namespaceId = useId()
  const hintId = useId()
  const [name, setName] = useState('')
  const [customNamespace, setCustomNamespace] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const namespace = customNamespace ?? namespaceFromName(name)
  const namespaceOk = isValidNamespace(namespace)
  const canCreate = name.trim() !== '' && namespaceOk

  function submit(event: FormEvent) {
    event.preventDefault()
    if (canCreate) onCreate(name.trim(), namespace)
    // A bad pack ID can only come from the hidden field: show it.
    else if (!namespaceOk) setAdvanced(true)
  }

  return (
    <Dialog
      open={open}
      title={t.home.newLibrary}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={!canCreate}>
            {t.home.createLibrary}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.field}>
          <label htmlFor={nameId}>{t.home.newLibraryName}</label>
          <input
            id={nameId}
            className={styles.input}
            value={name}
            autoComplete="off"
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {replacing !== null && (
          <p className={styles.hint}>{format(t.home.replaceHint, { name: replacing })}</p>
        )}
        <details
          className={styles.advanced}
          open={advanced || !namespaceOk}
          onToggle={(e) => setAdvanced(e.currentTarget.open)}
        >
          <summary>{t.home.advanced}</summary>
          <div className={styles.field}>
            <label htmlFor={namespaceId}>{t.home.packId}</label>
            <input
              id={namespaceId}
              className={`${styles.input} ${styles.mono}`}
              value={namespace}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!namespaceOk}
              aria-describedby={hintId}
              onChange={(e) => setCustomNamespace(e.target.value)}
            />
            <p id={hintId} className={namespaceOk ? styles.hint : styles.invalid}>
              {namespaceOk ? t.home.packIdHint : t.home.namespaceInvalid}
            </p>
          </div>
        </details>
      </form>
    </Dialog>
  )
}
