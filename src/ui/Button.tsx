import type { ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'
import { Icon, type IconName } from './Icon.tsx'

export type ButtonProps = {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'md' | 'lg'
  icon?: IconName
} & ButtonHTMLAttributes<HTMLButtonElement>

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    variant === 'primary' && styles.primary,
    variant === 'ghost' && styles.ghost,
    size === 'lg' && styles.lg,
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button type={type} className={classes} {...rest}>
      {icon && <Icon name={icon} size={size === 'lg' ? 18 : 16} />}
      {children}
    </button>
  )
}
