import { useEffect, useRef, useState } from 'react'
import { ShapeError } from '../../domain/errors.ts'
import { readyToExport, whatsNew } from '../../domain/library.ts'
import type { Library } from '../../domain/types.ts'
import { validateForExport } from '../../domain/validate.ts'
import { currentDictionary, format, useT } from '../../i18n/i18n.ts'
import { setLeaveGuard, useNavigation } from '../../state/navigation.ts'
import { useWorkspace } from '../../state/workspace.ts'
import { Button } from '../../ui/Button.tsx'
import { copyText, selectText } from '../../ui/clipboard.ts'
import { downloadBytes } from '../../ui/download.ts'
import { errorMessage } from '../../ui/errors.ts'
import { toast } from '../../ui/toastStore.ts'
import { TopBar } from '../../ui/TopBar.tsx'
import { buildLibraryPack } from '../../workers/packClient.ts'
import { discordText } from './exportText.ts'
import styles from './ExportScreen.module.css'
import { exportPlan } from './exportPlan.ts'
import { PackPanel, type Phase } from './PackPanel.tsx'
import { SelectionPanel } from './SelectionPanel.tsx'
import { ServerPanel } from './ServerPanel.tsx'

const readyIds = (lib: Library) => new Set(readyToExport(lib).map((p) => p.id))

export function ExportScreen() {
  const t = useT()
  const go = useNavigation((s) => s.go)
  const library = useWorkspace((s) => s.library)
  const demo = useWorkspace((s) => s.demo)
  const hasLoose = useWorkspace((s) => s.loose.length > 0)

  useEffect(() => {
    if (library && !demo) return
    // StrictMode runs effects twice; only the first run still sees the export screen.
    if (useNavigation.getState().screen.name !== 'export') return
    if (library) {
      // The demo is never exported (R23).
      toast(t.library.demoBanner)
      go({ name: 'library' }, { replace: true })
      return
    }
    toast(t.export.needsLibrary)
    go(hasLoose ? { name: 'library' } : { name: 'home' }, { replace: true })
  }, [library, demo, hasLoose, go, t])

  if (!library || demo) return null
  return <ExportView library={library} />
}

function ExportView({ library }: { library: Library }) {
  const t = useT()
  const go = useNavigation((s) => s.go)
  const assets = useWorkspace((s) => s.assets)
  const [selected, setSelected] = useState(() => readyIds(library))
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' })
  /** The build in progress; leaving the screen stops it. */
  const building = useRef<AbortController | null>(null)
  useEffect(() => () => building.current?.abort(), [])

  const done = phase.kind === 'done' ? phase.result : null
  const busy = phase.kind === 'busy'

  // Browser Back and Forward can't leave a build half-way (R32): the URL stays on Export.
  useEffect(() => {
    if (!busy) return
    setLeaveGuard(() => {
      toast(currentDictionary().export.waitForExport)
      return false
    })
    return () => setLeaveGuard(null)
  }, [busy])

  const selectedIds = library.paintings
    .filter((p) => p.status !== 'published' && selected.has(p.id))
    .map((p) => p.id)
  const plan = phase.kind === 'done' ? phase.plan : exportPlan(library, selectedIds)
  const again = plan.kind === 'again'
  // "Nothing new" is what the plan and its button already say.
  const issues = done
    ? []
    : validateForExport(library, again ? [] : selectedIds, assets).filter(
        (i) => i.code !== 'nothing-new',
      )
  const blocking = issues.some((i) => i.blocking)
  const shown = done ? done.library : library
  const version = done ? done.library.version : again ? library.version : library.version + 1
  const news =
    done || again
      ? whatsNew(shown, version)
      : library.paintings.filter((p) => selectedIds.includes(p.id))

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function runExport() {
    const state = useWorkspace.getState()
    if (!state.library || busy) return
    const build = new AbortController()
    building.current = build
    const planned = plan
    setPhase({ kind: 'busy', done: 0, total: 0 })
    try {
      const result = await buildLibraryPack(
        state.library,
        planned.kind === 'again' ? [] : selectedIds,
        state.assets,
        new Date(),
        (done, total) => {
          if (!build.signal.aborted) setPhase({ kind: 'busy', done, total })
        },
        build.signal,
        planned.kind === 'again',
      )
      // Left the screen meanwhile: no late download, and the library stays as it is.
      if (build.signal.aborted) return
      downloadBytes(result.bytes, result.fileName, 'application/zip')
      // Downloading a version again publishes nothing (C5).
      if (planned.kind !== 'again') useWorkspace.getState().applyExport(result.library)
      setPhase({ kind: 'done', result, plan: planned })
    } catch (error) {
      if (build.signal.aborted) return
      if (error instanceof ShapeError && error.code === 'export-failed') {
        // The message is developer text in English; players get a translated reason.
        console.error('Export failed', error)
        toast(errorMessage(error, t, { reason: t.export.failedReason }), 'error')
      } else {
        toast(errorMessage(error, t), 'error')
      }
      setPhase({ kind: 'choose' })
    }
  }

  function startAgain() {
    setSelected(readyIds(useWorkspace.getState().library ?? library))
    setPhase({ kind: 'choose' })
  }

  /** Copies `text`; when that fails, selects `source` (if any) for a manual copy and says so. */
  async function copy(text: string, source: HTMLElement | null): Promise<boolean> {
    if (await copyText(text)) return true
    if (source) {
      selectText(source)
      toast(t.export.copyFailed, 'error')
    } else {
      toast(t.export.copyBlocked, 'error')
    }
    return false
  }

  let checks = { label: t.export.checksPassed, tone: styles.ok }
  if (blocking || plan.kind === 'nothing') {
    checks = { label: t.export.checksBlocked, tone: styles.danger }
  } else if (issues.length > 0) checks = { label: t.export.checksWarnings, tone: styles.warn }

  return (
    <div className={styles.page}>
      <TopBar
        onHome={() => go({ name: 'home' })}
        homeDisabled={busy}
        left={
          <div className={styles.topLeft}>
            <Button
              variant="ghost"
              icon="arrow-left"
              disabled={busy}
              onClick={() => go({ name: 'library' })}
            >
              {t.export.back}
            </Button>
            <h1 className={styles.heading}>{format(t.export.heading, { name: library.name })}</h1>
          </div>
        }
        right={!done && <span className={`${styles.chip} ${checks.tone}`}>{checks.label}</span>}
      />
      <main className={styles.columns}>
        <SelectionPanel
          library={library}
          selected={selected}
          locked={phase.kind !== 'choose'}
          onToggle={toggle}
        />
        <PackPanel
          library={shown}
          plan={plan}
          phase={phase}
          version={version}
          news={news}
          issues={issues}
          onExport={() => void runExport()}
          onDownloadAgain={() => {
            if (done) downloadBytes(done.bytes, done.fileName, 'application/zip')
          }}
          onStartAgain={startAgain}
          onCopyDiscord={() =>
            done
              ? copy(discordText(done.library, done.library.version, t), null)
              : Promise.resolve(false)
          }
        />
        <ServerPanel namespace={library.namespace} sha1={done?.sha1 ?? null} copy={copy} />
      </main>
    </div>
  )
}
