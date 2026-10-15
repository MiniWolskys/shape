import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import styles from './FileDrop.module.css'

interface FileDropProps {
  /** Same syntax as <input accept>: MIME types, `type/*` wildcards and `.ext` suffixes. */
  accept: string
  onFiles(files: File[]): void
  children: ReactNode
  /** Accept drops anywhere in the window instead of only on this element. */
  fullWindow?: boolean
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

/**
 * Drop target for files (highlighted while dragging); pasted files are accepted too.
 * A local zone handles drops on itself and pastes while focus is inside it; a `fullWindow`
 * instance handles every other drop and paste.
 */
export function FileDrop({ accept, onFiles, children, fullWindow = false }: FileDropProps) {
  const [active, setActive] = useState(false)
  const depth = useRef(0)
  const zone = useRef<HTMLDivElement>(null)
  // Latest props for the document/window listeners without re-subscribing every render.
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
      const focusInside = zone.current?.contains(document.activeElement) ?? false
      if (fullWindow ? insideLocalZone(document.activeElement) : !focusInside) return
      if (deliver(event.clipboardData?.files)) event.preventDefault()
    }
    document.addEventListener('paste', onPaste)
    if (!fullWindow) return () => document.removeEventListener('paste', onPaste)

    function onEnter(event: globalThis.DragEvent) {
      if (!hasFiles(event.dataTransfer)) return
      event.preventDefault()
      depth.current += 1
      setActive(true)
    }
    function onOver(event: globalThis.DragEvent) {
      if (hasFiles(event.dataTransfer)) event.preventDefault()
    }
    function onLeave() {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setActive(false)
    }
    // Capture phase: runs before any local zone, so the overlay always clears.
    function onDrop(event: globalThis.DragEvent) {
      reset()
      if (!hasFiles(event.dataTransfer) || insideLocalZone(event.target)) return
      event.preventDefault()
      deliver(event.dataTransfer?.files)
    }
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
  }, [fullWindow])

  if (fullWindow) {
    return (
      <>
        {children}
        {active && <div className={styles.overlay} data-drop-overlay aria-hidden="true" />}
      </>
    )
  }

  function onDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event.dataTransfer)) return
    event.preventDefault()
    depth.current += 1
    setActive(true)
  }
  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (hasFiles(event.dataTransfer)) event.preventDefault()
  }
  function onDragLeave() {
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setActive(false)
  }
  function onDrop(event: DragEvent<HTMLDivElement>) {
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
