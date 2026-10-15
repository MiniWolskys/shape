import type { HTMLAttributes } from 'react'
import type { BackdropKind } from './backdrop.ts'
import styles from './Backdrop.module.css'

type BackdropProps = { kind: BackdropKind } & HTMLAttributes<HTMLDivElement>

/** Neutral surface paintings are shown on: checkerboards in three greys, or a sky gradient. */
export function Backdrop({ kind, className, ...rest }: BackdropProps) {
  const classes = [styles.backdrop, styles[kind], className].filter(Boolean).join(' ')
  return <div className={classes} data-backdrop={kind} {...rest} />
}
