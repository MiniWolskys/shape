import { useEffect, useRef, useState } from 'react'

/** The content box of an element, tracked while it resizes; `fallback` until it is measured. */
export function useContentBox<T extends HTMLElement = HTMLDivElement>(fallback: {
  width: number
  height: number
}) {
  const ref = useRef<T>(null)
  const [box, setBox] = useState(fallback)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setBox({ width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, box] as const
}
