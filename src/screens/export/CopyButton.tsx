import { useEffect, useState, type ReactNode } from 'react'
import { useT } from '../../i18n/i18n.ts'
import { Button } from '../../ui/Button.tsx'

/** How long a copy button says "Copied ✓" (M1). */
const COPIED_MS = 2000

/** A copy button that says "Copied ✓" for 2 s once `onCopy` resolves true (M1). */
export function CopyButton({
  label,
  onCopy,
  disabled,
  className,
  children,
}: {
  /** The accessible name, when the visible text alone is not enough. */
  label?: string
  onCopy(): Promise<boolean>
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <>
      <Button
        icon="copy"
        aria-label={label}
        className={className}
        disabled={disabled}
        onClick={() => {
          void onCopy().then((ok) => {
            if (ok) setCopied(true)
          })
        }}
      >
        {copied ? t.common.copiedCheck : children}
      </Button>
      {/* `label` names the button, so the confirmation is announced on its own. */}
      <span role="status" className="visually-hidden">
        {copied ? t.common.copied : ''}
      </span>
    </>
  )
}
