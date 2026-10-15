import { useEffect, useRef } from 'react'
import { useT } from '../i18n/i18n.ts'
import { useNavigation } from '../state/navigation.ts'
import styles from './Toasts.module.css'
import { holdToasts, useToasts, type ToastItem } from './toastStore.ts'

function Toast({ item }: { item: ToastItem }) {
  const t = useT()
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div
      className={[styles.toast, item.kind === 'error' && styles.error].filter(Boolean).join(' ')}
    >
      <span className={styles.message}>{item.message}</span>
      {item.action && (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            dismiss(item.id)
            item.action?.run()
          }}
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        className={styles.dismiss}
        aria-label={t.common.close}
        onClick={() => dismiss(item.id)}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  )
}

/**
 * Toasts at the bottom centre; in the editor, centred over the painting so they never cover the
 * inspector (M1). Errors are announced at once (role="alert"), the rest politely.
 */
export function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  const region = useRef<HTMLDivElement>(null)
  // A focused toast that goes away (its action ran) takes the focus with it, without a blur.
  useEffect(() => {
    if (!region.current?.contains(document.activeElement)) holdToasts('focus', false)
  }, [toasts])
  const inEditor = useNavigation((s) => s.screen.name === 'editor')
  const errors = toasts.filter((item) => item.kind === 'error')
  const others = toasts.filter((item) => item.kind !== 'error')
  return (
    <div
      ref={region}
      className={styles.region}
      data-area={inEditor ? 'stage' : undefined}
      onMouseEnter={() => holdToasts('hover', true)}
      onMouseLeave={() => holdToasts('hover', false)}
      onFocus={() => holdToasts('focus', true)}
      onBlur={(event) => {
        // Focus moving between two toasts stays inside.
        if (!event.currentTarget.contains(event.relatedTarget)) holdToasts('focus', false)
      }}
    >
      <div role="alert" className={styles.stack}>
        {errors.map((item) => (
          <Toast key={item.id} item={item} />
        ))}
      </div>
      <div role="status" aria-live="polite" className={styles.stack}>
        {others.map((item) => (
          <Toast key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}
