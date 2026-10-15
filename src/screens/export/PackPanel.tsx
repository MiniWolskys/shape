import type { Library, Painting } from '../../domain/types.ts'
import type { Issue } from '../../domain/validate.ts'
import { format, plural, useT } from '../../i18n/i18n.ts'
import type { LibraryPackResult } from '../../packs/libraryPack.ts'
import { Button } from '../../ui/Button.tsx'
import { Icon } from '../../ui/Icon.tsx'
import { CopyButton } from './CopyButton.tsx'
import type { Plan } from './exportPlan.ts'
import { issueMessage, libraryDetail, newsLine } from './exportText.ts'
import styles from './ExportScreen.module.css'

export type Phase =
  | { kind: 'choose' }
  | { kind: 'busy'; done: number; total: number }
  | { kind: 'done'; result: LibraryPackResult; plan: Plan }

interface PackPanelProps {
  /** The library the pack holds (as exported, once done). */
  library: Library
  plan: Plan
  phase: Phase
  /** The version the pack will have. */
  version: number
  /** Paintings new in that version. */
  news: Painting[]
  issues: Issue[]
  onExport(): void
  onDownloadAgain(): void
  onStartAgain(): void
  onCopyDiscord(): Promise<boolean>
}

const kilobytes = (bytes: number) => Math.max(1, Math.round(bytes / 1024))

function buttonLabel(plan: Plan, version: number, t: ReturnType<typeof useT>): string {
  switch (plan.kind) {
    case 'publish':
      return plural(t, t.export.publishAndDownload, plan.count, { version })
    case 'update':
      return plural(t, t.export.updateAndDownload, plan.count, { version })
    case 'backup':
      return t.export.downloadBackup
    case 'again':
      return format(t.export.downloadVersionAgain, { version })
    case 'nothing':
      return format(t.export.downloadVersion, { version })
  }
}

/** The version, the file and what is in it, the main button, and what's new. */
export function PackPanel({
  library,
  plan,
  phase,
  version,
  news,
  issues,
  onExport,
  onDownloadAgain,
  onStartAgain,
  onCopyDiscord,
}: PackPanelProps) {
  const t = useT()
  const done = phase.kind === 'done' ? phase.result : null
  const busy = phase.kind === 'busy'
  /** The current version, as it is or as a backup: no new version (C5, R35). */
  const again = plan.kind === 'again' || plan.kind === 'backup'
  const blocking = issues.some((i) => i.blocking) || plan.kind === 'nothing'
  const fileName = `${library.namespace}-v${version}${plan.kind === 'backup' ? '-backup' : ''}.zip`
  const ns = library.namespace
  const total = library.paintings.filter((p) => p.status === 'published' || news.includes(p)).length

  let action
  if (done) {
    const published = plan.kind === 'publish' ? plan.count : 0
    action = (
      <div className={styles.done} role="status">
        <p>
          <Icon name="check" size={16} className={styles.okIcon} />{' '}
          {format(t.export.started, { file: done.fileName })}
        </p>
        {published > 0 && <p>{plural(t, t.export.nowPublished, published)}</p>}
        <div className={styles.row}>
          <span className={styles.muted}>{t.export.noFile}</span>
          <Button icon="download" onClick={onDownloadAgain}>
            {t.export.downloadAgain}
          </Button>
        </div>
        <Button variant="ghost" className={styles.startAgain} onClick={onStartAgain}>
          {t.export.exportAgain}
        </Button>
      </div>
    )
  } else {
    action = (
      <>
        {plan.kind === 'publish' && (
          <p className={styles.note} role="note">
            {t.export.publishNote}
          </p>
        )}
        {plan.kind === 'again' && <p className={styles.muted}>{t.export.againNote}</p>}
        {plan.kind === 'backup' && (
          <p className={styles.muted}>{plural(t, t.export.backupNote, plan.count, { version })}</p>
        )}
        <Button
          variant="primary"
          size="lg"
          icon="download"
          className={styles.download}
          disabled={blocking || busy}
          aria-busy={busy}
          onClick={onExport}
        >
          {phase.kind === 'busy'
            ? phase.total > 0
              ? format(t.export.rendering, { done: phase.done, total: phase.total })
              : t.export.exporting
            : buttonLabel(plan, version, t)}
        </Button>
        {plan.kind === 'nothing' ? (
          <p className={styles.blockedHint}>{t.export.pickFirst}</p>
        ) : (
          blocking && <p className={styles.blockedHint}>{t.export.blockedHint}</p>
        )}
      </>
    )
  }

  return (
    <section className={styles.panel} aria-label={t.export.downloadPack}>
      <div className={styles.version}>
        {!again && (
          <>
            <span className={styles.muted}>
              {format(t.export.version, { version: version - 1 })}
            </span>
            <span aria-hidden="true">→</span>
          </>
        )}
        <span className={styles.accent}>{format(t.export.version, { version })}</span>
        <small className={styles.counts}>
          {!again && <span>{plural(t, t.export.newCount, news.length)}</span>}
          <span>{format(t.export.totalCount, { count: total })}</span>
        </small>
      </div>

      <div className={styles.file}>
        <Icon name="download" size={26} />
        <div className={styles.fileText}>
          <b>{fileName}</b>
          <span className={styles.muted}>
            {done
              ? format(t.export.fileHintSize, {
                  size: format(t.export.kilobytes, { size: kilobytes(done.bytes.length) }),
                })
              : t.export.fileHint}
          </span>
        </div>
      </div>

      <dl className={styles.inside} aria-label={t.export.inside}>
        <div>
          <dt>{t.export.insideLibrary}</dt>
          <dd>{libraryDetail(library, t)}</dd>
        </div>
        <div>
          <dt>{t.export.insideDatapack}</dt>
          <dd>{`${ns}-datapack.zip`}</dd>
        </div>
        <div>
          <dt>{t.export.insideResources}</dt>
          <dd>{`${ns}-resources.zip`}</dd>
        </div>
        <div>
          <dt>{t.export.insideSha1}</dt>
          <dd>{t.export.insideSha1Detail}</dd>
        </div>
      </dl>

      {issues.length > 0 && (
        <ul className={styles.issues} aria-label={t.export.issues}>
          {issues.map((issue, i) => (
            <li
              key={`${issue.code}:${issue.paintingId ?? i}`}
              className={issue.blocking ? styles.blocking : styles.warning}
            >
              {issueMessage(issue, library, t)}
            </li>
          ))}
        </ul>
      )}

      {action}

      <h3 className={styles.label}>{format(t.export.whatsNew, { version })}</h3>
      {news.length === 0 ? (
        <p className={styles.muted}>{t.export.nothingNew}</p>
      ) : (
        <ul className={styles.news}>
          {news.map((p) => (
            <li key={p.id}>{newsLine(p, t)}</li>
          ))}
        </ul>
      )}
      {done && (
        <CopyButton className={styles.discord} onCopy={onCopyDiscord}>
          {t.export.copyDiscord}
        </CopyButton>
      )}
    </section>
  )
}
