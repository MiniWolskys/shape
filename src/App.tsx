import { useEffect, useState } from 'react'
import styles from './App.module.css'
import { useT } from './i18n/i18n.ts'
import { EditorScreen } from './screens/editor/EditorScreen.tsx'
import { ExportScreen } from './screens/export/ExportScreen.tsx'
import { HomeScreen } from './screens/home/HomeScreen.tsx'
import { LibraryScreen } from './screens/library/LibraryScreen.tsx'
import { AppFileDrop } from './screens/AppFileDrop.tsx'
import { useEditor } from './state/editor.ts'
import { startHashRouting, useNavigation, type Screen } from './state/navigation.ts'
import { useWorkspace } from './state/workspace.ts'
import { Button } from './ui/Button.tsx'
import { documentTitle } from './ui/documentTitle.ts'
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

export function App() {
  const ready = useWorkspace((s) => s.ready)
  const screen = useNavigation((s) => s.screen)
  const [storageFailed, setStorageFailed] = useState(false)
  useDocumentTitle(screen)

  // The screen lives in the URL: Back, Forward and reloads follow it (I10).
  useEffect(() => startHashRouting(), [])

  useEffect(() => {
    // init returns the same promise while it runs, so StrictMode's second call is harmless.
    useWorkspace
      .getState()
      .init()
      .catch((error: unknown) => {
        console.error('Could not open the browser storage', error)
        setStorageFailed(true)
      })
  }, [])

  let content
  if (ready) content = <Route screen={screen} />
  else if (storageFailed) content = <StorageFailure />
  else content = <Loading />

  return (
    <>
      {content}
      <AppFileDrop />
      <Toasts />
    </>
  )
}
