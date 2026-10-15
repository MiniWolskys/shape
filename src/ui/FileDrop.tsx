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

/** Drop target for files (highlighted while dragging); pasted files are accepted too. */
export function FileDrop({ accept, onFiles, children, fullWindow = false }: FileDropProps) {
  const [active, setActive] = useState(false)
  const depth = useRef(0)
  // Latest props for the window listeners without re-subscribing every render.
  const latest = useRef({ accept, onFiles })
  useEffect(() => {
    latest.current = { accept, onFiles }
  })

  useEffect(() => {
    function deliver(list: FileList | null | undefined) {
      const files = Array.from(list ?? []).filter((f) => matchesAccept(f, latest.current.accept))
      if (files.length > 0) latest.current.onFiles(files)
      return files.length > 0
    }

    function onPaste(event: ClipboardEvent) {
      const target = event.target
      if (event.defaultPrevented) return
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
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
    function onDrop(event: globalThis.DragEvent) {
      if (!hasFiles(event.dataTransfer)) return
      event.preventDefault()
      depth.current = 0
      setActive(false)
      deliver(event.dataTransfer?.files)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('paste', onPaste)
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [fullWindow])

  if (fullWindow) {
    return (
      <>
        {children}
        {active && <div className={styles.overlay} aria-hidden="true" />}
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
    if (!hasFiles(event.dataTransfer)) return
    event.preventDefault()
    // Keeps a full-window FileDrop from receiving the same files.
    event.stopPropagation()
    depth.current = 0
    setActive(false)
    const files = Array.from(event.dataTransfer.files).filter((f) => matchesAccept(f, accept))
    if (files.length > 0) onFiles(files)
  }

  return (
    <div
      className={[styles.zone, active && styles.active].filter(Boolean).join(' ')}
      data-active={active || undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
    </div>
  )
}
