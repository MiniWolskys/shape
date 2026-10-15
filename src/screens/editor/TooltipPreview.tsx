import type { CSSProperties } from 'react'
import { MC_COLOR_HEX, type McColor } from '../../domain/types.ts'
import { useT } from '../../i18n/i18n.ts'
import styles from './TooltipPreview.module.css'

interface TooltipPreviewProps {
  title: string
  titleColor: McColor
  author: string
  authorColor: McColor
  width: number
  height: number
}

/** The painting's item tooltip as players see it in game: title, author, size in blocks. */
export function TooltipPreview({
  title,
  titleColor,
  author,
  authorColor,
  width,
  height,
}: TooltipPreviewProps) {
  const t = useT()
  const color = (c: McColor) => ({ '--mc': MC_COLOR_HEX[c] }) as CSSProperties
  return (
    <figure className={styles.figure} aria-label={t.editor.details.preview}>
      <div className={styles.tooltip}>
        <span className={styles.line} style={color(titleColor)} data-empty={!title || undefined}>
          {title || t.library.untitled}
        </span>
        {author && (
          <span className={styles.line} style={color(authorColor)}>
            {author}
          </span>
        )}
        <span className={styles.line} style={color('white')}>{`${width}×${height}`}</span>
      </div>
    </figure>
  )
}
