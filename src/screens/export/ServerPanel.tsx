import { Fragment, useId, useRef } from 'react'
import { useT } from '../../i18n/i18n.ts'
import { serverPropertiesLines } from '../../packs/libraryPack.ts'
import { CopyButton } from './CopyButton.tsx'
import styles from './ExportScreen.module.css'

interface ServerPanelProps {
  namespace: string
  /** The resource pack's SHA1 once the pack is built. */
  sha1: string | null
  /** Copies `text`; `source` is selected for a manual copy when that fails. */
  copy(text: string, source: HTMLElement | null): Promise<boolean>
}

/** A step's text with `{name}` placeholders shown as code, e.g. file paths. */
function withCode(template: string, values: Record<string, string>) {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const value = /^\{(\w+)\}$/.exec(part)?.[1]
    const code = value === undefined ? undefined : values[value]
    return code === undefined ? <Fragment key={i}>{part}</Fragment> : <code key={i}>{code}</code>
  })
}

/** The SHA1, the server.properties lines and the steps for the server owner (I12, I21). */
export function ServerPanel({ namespace, sha1, copy }: ServerPanelProps) {
  const t = useT()
  const headingId = useId()
  const sha1Ref = useRef<HTMLElement>(null)
  const propertiesRef = useRef<HTMLPreElement>(null)
  const properties = serverPropertiesLines(sha1 ?? '…', t.export.linkPlaceholder)
  const files = {
    datapack: `server/${namespace}-datapack.zip`,
    resources: `server/${namespace}-resources.zip`,
    folder: 'world/datapacks/',
    host: 'mc-packs.net',
  }

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.h2}>
        {t.export.putOnServer}
      </h2>
      <h3 className={styles.label}>{t.export.sha1Label}</h3>
      <div className={styles.row}>
        {sha1 ? (
          <code ref={sha1Ref} className={styles.code} data-testid="sha1">
            {sha1}
          </code>
        ) : (
          <span className={`${styles.code} ${styles.pending}`}>{t.export.sha1Pending}</span>
        )}
        <CopyButton
          label={t.export.copySha1}
          disabled={!sha1}
          onCopy={() => (sha1 ? copy(sha1, sha1Ref.current) : Promise.resolve(false))}
        >
          {t.common.copy}
        </CopyButton>
      </div>
      <h3 className={styles.label}>{t.export.serverProperties}</h3>
      <pre
        ref={propertiesRef}
        className={`${styles.code} ${styles.properties}`}
        data-testid="server-properties"
        tabIndex={0}
      >
        {properties}
      </pre>
      <div>
        <CopyButton
          label={t.export.copyProperties}
          disabled={!sha1}
          onCopy={() => copy(properties, propertiesRef.current)}
        >
          {t.common.copy}
        </CopyButton>
      </div>
      <ol className={styles.steps} aria-label={t.export.serverStepsLabel} start={0}>
        <li>{t.export.serverSteps.mod}</li>
        <li>{withCode(t.export.serverSteps.datapack, files)}</li>
        <li>{withCode(t.export.serverSteps.resources, files)}</li>
        <li>{t.export.serverSteps.properties}</li>
        <li>{t.export.serverSteps.restart}</li>
      </ol>
      <p className={styles.never} role="note">
        {t.export.neverDelete}
      </p>
    </section>
  )
}
