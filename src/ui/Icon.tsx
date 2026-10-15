import type { ReactNode } from 'react'

const PATHS = {
  folder: (
    <>
      <path d="M4 7h6l2 2h8v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M12 12v5M9.5 14.5 12 12l2.5 2.5" />
    </>
  ),
  image: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M4 15l5-5 4 4 3-3 4 4" />
      <circle cx="15.5" cy="8.5" r="1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="1" />
      <path d="M8 10V8a4 4 0 1 1 8 0v2" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
  redo: (
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h3" />
    </>
  ),
  pencil: <path d="M4 20l4-1 11-11-3-3L5 16z" />,
  fill: (
    <>
      <path d="M5 11l7-7 7 7-7 7z" />
      <path d="M20 15s2 2.5 2 4a2 2 0 0 1-4 0c0-1.5 2-4 2-4z" />
    </>
  ),
  replace: (
    <>
      <rect x="3" y="3" width="8" height="8" />
      <rect x="13" y="13" width="8" height="8" />
      <path d="M15 5h4v4M9 19H5v-4" />
    </>
  ),
  wand: <path d="M4 20 15 9M15 4v2M20 9h-2M18.5 5.5 17 7M11 6 9.5 4.5" />,
  eyedropper: (
    <>
      <path d="M14 6l4 4M3 21l2-1 10-10-3-3L2 17z" />
      <path d="M16 4l4 4 1-1a2.8 2.8 0 0 0-4-4z" />
    </>
  ),
  eraser: <path d="M8 20h12M4 15l9-9 6 6-7 7H8z" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="1" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  'arrow-left': <path d="M19 12H5M11 6l-6 6 6 6" />,
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </g>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

interface IconProps {
  name: IconName
  size?: number
  /** Accessible name; without it the icon is decorative and hidden from assistive tech. */
  label?: string
  className?: string
}

export function Icon({ name, size = 16, label, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      style={{ flex: 'none' }}
    >
      {PATHS[name]}
    </svg>
  )
}
