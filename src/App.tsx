import { useEffect, useState } from 'react'
import styles from './App.module.css'
import { useT } from './i18n/i18n.ts'
import { HomeScreen } from './screens/home/HomeScreen.tsx'
import { useNavigation, type Screen } from './state/navigation.ts'
import { useWorkspace } from './state/workspace.ts'
import { Button } from './ui/Button.tsx'
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

/** Stands in for a screen a later task builds. */
function Placeholder({ title }: { title: string }) {
  const t = useT()
  const go = useNavigation((s) => s.go)
  return (
    <div className={styles.page}>
      <TopBar />
      <main className={styles.centered}>
        <div className={styles.notice}>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.body}>{t.placeholder.soon}</p>
          <Button icon="arrow-left" onClick={() => go({ name: 'home' })}>
            {t.placeholder.backHome}
          </Button>
        </div>
      </main>
    </div>
  )
}

function Route({ screen }: { screen: Screen }) {
  const t = useT()
  switch (screen.name) {
    case 'home':
      return <HomeScreen />
    case 'library':
      return <Placeholder title={t.library.title} />
    case 'editor':
      return <Placeholder title={t.editor.title} />
    case 'export':
      return <Placeholder title={t.export.title} />
  }
}

export function App() {
  const ready = useWorkspace((s) => s.ready)
  const screen = useNavigation((s) => s.screen)
  const [storageFailed, setStorageFailed] = useState(false)

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
      <Toasts />
    </>
  )
}
