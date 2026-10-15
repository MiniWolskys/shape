import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import styles from './App.module.css'
import { format, useT } from './i18n/i18n.ts'
import { EditorScreen } from './screens/editor/EditorScreen.tsx'
import { ExportScreen } from './screens/export/ExportScreen.tsx'
import { HomeScreen } from './screens/home/HomeScreen.tsx'
import { LibraryScreen } from './screens/library/LibraryScreen.tsx'
import { AppFileDrop } from './screens/AppFileDrop.tsx'
import { SaveFailureBanner } from './screens/SaveFailureBanner.tsx'
import { useEditor } from './state/editor.ts'
import { startHashRouting, useNavigation, type Screen } from './state/navigation.ts'
import { startTabLock, useTabLock } from './state/tabLock.ts'
import { useWorkspace } from './state/workspace.ts'
import { Button } from './ui/Button.tsx'
import { documentTitle } from './ui/documentTitle.ts'
import { createScrollMemory, scrollKey } from './ui/scrollMemory.ts'
import { toast } from './ui/toastStore.ts'
import { Toasts } from './ui/Toasts.tsx'
import { TopBar } from './ui/TopBar.tsx'

function Loading() {
  const t = useT()
  return (
    <div className={`${styles.centered} ${styles.fullscreen}`}>
      <p role="status" className={styles.loading}>
        {t.startup.loading}
      </p>
    </div>
  )
}

function StorageFailure() {
  const t = useT()
  return (
    <div className={styles.page}>
      <TopBar />
      <main className={styles.centered}>
        <div className={styles.notice}>
          <h1 className={styles.title}>{t.startup.storageTitle}</h1>
          <p className={styles.body}>{t.startup.storageBody}</p>
          <Button variant="primary" onClick={() => useWorkspace.setState({ ready: true })}>
            {t.startup.continueWithoutSaving}
          </Button>
        </div>
      </main>
    </div>
  )
}

/** Another tab is the active one (R38): nothing here reads or writes the workspace. */
function OtherTabNotice() {
  const t = useT()
  const takeOver = useTabLock((s) => s.takeOver)
  return (
    <div className={styles.page}>
      <TopBar />
      <main className={styles.centered}>
        <div className={styles.notice}>
          <h1 className={styles.title}>{t.otherTab.title}</h1>
          <p className={styles.body}>{t.otherTab.body}</p>
          <Button variant="primary" onClick={takeOver}>
            {t.otherTab.useHere}
          </Button>
        </div>
      </main>
    </div>
  )
}

function Route({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case 'home':
      return <HomeScreen />
    case 'library':
      return <LibraryScreen />
    case 'editor':
      // No key: a save may give the open painting a new id without leaving the editor (R17);
      // EditorScreen keys its own grid by editing session instead.
      return <EditorScreen paintingId={screen.paintingId} />
    case 'export':
      return <ExportScreen />
  }
}

/** The browser tab names the screen, and in the editor the painting (M6). */
function useDocumentTitle(screen: Screen) {
  const t = useT()
  const paintingTitle = useEditor((s) => s.painting?.title ?? null)
  const title = documentTitle(screen, t, screen.name === 'editor' ? paintingTitle : null)
  useEffect(() => {
    document.title = title
  }, [title])
}

/**
 * Each screen opens at its top, except through browser Back and Forward, which return to where
 * the player left it (e.g. deep in the Library).
 */
/** How soon after a Back or Forward a screen change still counts as caused by it. */
const HISTORY_MOVE_MS = 1000

function useScrollPerScreen(screen: Screen) {
  const key = scrollKey(screen)
  const memory = useRef(createScrollMemory())
  const current = useRef(key)
  /** When the browser last moved through its history; a screen change soon after came from it. */
  const historyAt = useRef(-Infinity)

  useEffect(() => {
    const onHistory = () => {
      historyAt.current = performance.now()
    }
    const onScroll = () => memory.current.save(current.current, document.documentElement.scrollTop)
    window.addEventListener('popstate', onHistory)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('popstate', onHistory)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  useLayoutEffect(() => {
    if (current.current === key) return
    current.current = key
    const fromHistory = performance.now() - historyAt.current < HISTORY_MOVE_MS
    document.documentElement.scrollTop = memory.current.target(key, fromHistory)
    historyAt.current = -Infinity
  }, [key])
}

/** Says once when stored pictures or edit layers were missing at load (I1). */
function useMissingAssetsNotice() {
  const t = useT()
  const missing = useWorkspace((s) => s.missingAssets)
  useEffect(() => {
    if (missing === 0) return
    toast(format(t.startup.missingAssets, { count: missing }), 'error')
    useWorkspace.setState({ missingAssets: 0 })
  }, [missing, t])
}

export function App() {
  const ready = useWorkspace((s) => s.ready)
  const screen = useNavigation((s) => s.screen)
  const [storageFailed, setStorageFailed] = useState(false)
  useDocumentTitle(screen)
  useMissingAssetsNotice()

  // The screen lives in the URL: Back, Forward and reloads follow it (I10).
  useEffect(() => startHashRouting(), [])
  useScrollPerScreen(screen)

  const tab = useTabLock((s) => s.status)
  useEffect(
    () =>
      startTabLock({
        // Another tab owns the stored workspace now: not one more write from here.
        onLost: () => useWorkspace.getState().suspend(),
        // What this tab holds in memory may be older than what the other tab saved.
        onRegained: () => window.location.reload(),
      }),
    [],
  )

  const active = tab === 'active'
  useEffect(() => {
    // Only the active tab reads the workspace (R38), as it is now (not as last rendered).
    if (!active || useTabLock.getState().status !== 'active') return
    // init returns the same promise while it runs, so StrictMode's second call is harmless.
    useWorkspace
      .getState()
      .init()
      .catch((error: unknown) => {
        console.error('Could not open the browser storage', error)
        setStorageFailed(true)
      })
  }, [active])

  let content
  if (tab === 'elsewhere') content = <OtherTabNotice />
  else if (!active) content = <Loading />
  else if (ready) content = <Route screen={screen} />
  else if (storageFailed) content = <StorageFailure />
  else content = <Loading />

  return (
    <>
      {ready && active && <SaveFailureBanner />}
      {content}
      <AppFileDrop />
      <Toasts />
    </>
  )
}
