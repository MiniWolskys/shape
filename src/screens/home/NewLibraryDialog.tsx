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

/** Asks for a library name and namespace; the namespace follows the name until edited. */
export function NewLibraryDialog({ open, replacing, onClose, onCreate }: NewLibraryDialogProps) {
  const t = useT()
  const formId = useId()
  const nameId = useId()
  const namespaceId = useId()
  const hintId = useId()
  const [name, setName] = useState('')
  const [customNamespace, setCustomNamespace] = useState<string | null>(null)
  const namespace = customNamespace ?? namespaceFromName(name)
  const namespaceOk = isValidNamespace(namespace)
  const canCreate = name.trim() !== '' && namespaceOk

  function submit(event: FormEvent) {
    event.preventDefault()
    if (canCreate) onCreate(name.trim(), namespace)
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
            {replacing === null ? t.home.createLibrary : t.home.replaceLibrary}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit} noValidate>
        {replacing !== null && (
          <p className={styles.warning}>{format(t.home.replaceWarning, { name: replacing })}</p>
        )}
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
        <div className={styles.field}>
          <label htmlFor={namespaceId}>{t.library.namespace}</label>
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
            {namespaceOk ? t.home.namespaceHint : t.home.namespaceInvalid}
          </p>
        </div>
      </form>
    </Dialog>
  )
}
