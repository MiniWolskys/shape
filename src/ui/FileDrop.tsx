import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from 'react'
import styles from './FileDrop.module.css'

interface FileDropProps {
  /** Same syntax as <input accept>: MIME types, `type/*` wildcards and `.ext` suffixes. */
  accept: string
  onFiles(files: File[]): void
  children: ReactNode
}

function matchesAccept(file: File, accept: string): boolean {
  const rules = accept
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean)
  if (rules.length === 0) return true
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  return rules.some((rule) => {
    if (rule.startsWith('.')) return name.endsWith(rule)
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1))
    return type === rule
  })
}

function hasFiles(transfer: DataTransfer | null): boolean {
  return !!transfer && Array.from(transfer.types).includes('Files')
}

const ZONE_ATTR = 'data-file-drop-zone'

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

function insideLocalZone(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${ZONE_ATTR}]`) !== null
}

/** The MIME types of the files being dragged (often empty, e.g. for zips on some systems). */
function draggedTypes(transfer: DataTransfer | null): string[] {
  return Array.from(transfer?.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.type)
}

interface WindowFileDropProps {
  /** Gets every file dropped outside a local zone, or pasted while focus is outside one. */
  onFiles(files: File[]): void
  /** The overlay's words for files of these MIME types (empty strings when unknown). */
  label(types: readonly string[]): string
  /** The overlay's words while a modal dialog is open, when files are not taken. */
  blockedLabel: string
}

/** A modal dialog is open: a file must not act on the screen behind it. */
const dialogOpen = () => document.querySelector('dialog[open]') !== null

/**
 * The app's one window-wide file handler (C4): every file drag is kept from the browser (which
 * would open the file in place of the app), shows an overlay saying what the drop will do, and
 * ends in `onFiles` unless a local zone takes it or a modal dialog is open. Pasted files go the
 * same way.
 */
export function WindowFileDrop({ onFiles, label, blockedLabel }: WindowFileDropProps) {
  const [drag, setDrag] = useState<{ types: string[]; blocked: boolean } | null>(null)
  const depth = useRef(0)
  // The latest handler for the window listeners without re-subscribing every render.
  const latest = useRef(onFiles)
  useEffect(() => {
    latest.current = onFiles
  })

  useEffect(() => {
    function reset() {
      depth.current = 0
      setDrag(null)
    }
    function deliver(list: FileList | null | undefined): boolean {
      const files = Array.from(list ?? [])
      if (files.length > 0) latest.current(files)
      return files.length > 0
    }
    function onPaste(event: ClipboardEvent) {
      if (event.defaultPrevented || isEditable(event.target)) return
      if (insideLocalZone(document.activeElement) || dialogOpen()) return
      if (deliver(event.clipboardData?.files)) event.preventDefault()
    }
    function onEnter(event: DragEvent) {
      if (!hasFiles(event.dataTransfer)) return
      event.preventDefault()
      depth.current += 1
      setDrag({ types: draggedTypes(event.dataTransfer), blocked: dialogOpen() })
    }
    function onOver(event: DragEvent) {
      if (hasFiles(event.dataTransfer)) event.preventDefault()
    }
    function onLeave() {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDrag(null)
    }
    // Capture phase: runs before any local zone, so the overlay always clears.
    function onDrop(event: DragEvent) {
      reset()
      if (!hasFiles(event.dataTransfer)) return
      event.preventDefault()
      if (!insideLocalZone(event.target) && !dialogOpen()) deliver(event.dataTransfer?.files)
    }
    document.addEventListener('paste', onPaste)
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop, true)
    window.addEventListener('dragend', reset, true)
    return () => {
      document.removeEventListener('paste', onPaste)
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragend', reset, true)
    }
  }, [])

  if (drag === null) return null
  return (
    <div className={styles.overlay} data-drop-overlay aria-hidden="true">
      <p className={styles.label}>{drag.blocked ? blockedLabel : label(drag.types)}</p>
    </div>
  )
}

/**
 * A local drop target for files (highlighted while dragging): it takes drops on itself and
 * pastes while focus is inside it; WindowFileDrop leaves both to it.
 */
export function FileDrop({ accept, onFiles, children }: FileDropProps) {
  const [active, setActive] = useState(false)
  const depth = useRef(0)
  const zone = useRef<HTMLDivElement>(null)
  // Latest props for the document listener without re-subscribing every render.
  const latest = useRef({ accept, onFiles })
  useEffect(() => {
    latest.current = { accept, onFiles }
  })

  function deliver(list: FileList | null | undefined): boolean {
    const files = Array.from(list ?? []).filter((f) => matchesAccept(f, latest.current.accept))
    if (files.length > 0) latest.current.onFiles(files)
    return files.length > 0
  }

  function reset() {
    depth.current = 0
    setActive(false)
  }

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      if (event.defaultPrevented || isEditable(event.target)) return
      if (!(zone.current?.contains(document.activeElement) ?? false)) return
      if (deliver(event.clipboardData?.files)) event.preventDefault()
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  function onDragEnter(event: ReactDragEvent<HTMLDivElement>) {
    if (!hasFiles(event.dataTransfer)) return
    event.preventDefault()
    depth.current += 1
    setActive(true)
  }
  function onDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (hasFiles(event.dataTransfer)) event.preventDefault()
  }
  function onDragLeave() {
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setActive(false)
  }
  function onDrop(event: ReactDragEvent<HTMLDivElement>) {
    reset()
    if (!hasFiles(event.dataTransfer)) return
    event.preventDefault()
    deliver(event.dataTransfer.files)
  }

  return (
    <div
      ref={zone}
      data-file-drop-zone=""
      className={[styles.zone, active && styles.active].filter(Boolean).join(' ')}
      data-active={active || undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={reset}
    >
      {children}
    </div>
  )
}
