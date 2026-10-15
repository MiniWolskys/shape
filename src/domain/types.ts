export const MC_COLORS = [
  'black',
  'dark_blue',
  'dark_green',
  'dark_aqua',
  'dark_red',
  'dark_purple',
  'gold',
  'gray',
  'dark_gray',
  'blue',
  'green',
  'aqua',
  'red',
  'light_purple',
  'yellow',
  'white',
] as const
export type McColor = (typeof MC_COLORS)[number]
export const MC_COLOR_HEX: Record<McColor, string> = {
  black: '#000000',
  dark_blue: '#0000AA',
  dark_green: '#00AA00',
  dark_aqua: '#00AAAA',
  dark_red: '#AA0000',
  dark_purple: '#AA00AA',
  gold: '#FFAA00',
  gray: '#AAAAAA',
  dark_gray: '#555555',
  blue: '#5555FF',
  green: '#55FF55',
  aqua: '#55FFFF',
  red: '#FF5555',
  light_purple: '#FF55FF',
  yellow: '#FFFF55',
  white: '#FFFFFF',
}
export const DYE_IDS = [
  'white',
  'light_gray',
  'gray',
  'black',
  'brown',
  'red',
  'orange',
  'yellow',
  'lime',
  'green',
  'cyan',
  'light_blue',
  'blue',
  'purple',
  'magenta',
  'pink',
] as const
export type DyeId = (typeof DYE_IDS)[number]

/** The 16 Minecraft dye colours (wool swatches of the design page). */
export const DYE_HEX: Record<DyeId, string> = {
  white: '#f9fffe',
  light_gray: '#9d9d97',
  gray: '#474f52',
  black: '#1d1d21',
  brown: '#835432',
  red: '#b02e26',
  orange: '#f9801d',
  yellow: '#fed83d',
  lime: '#80c71f',
  green: '#5e7c16',
  cyan: '#169c9c',
  light_blue: '#3ab3da',
  blue: '#3c44aa',
  purple: '#8932b8',
  magenta: '#c74ebd',
  pink: '#f38baa',
}

export const SHAPE_IDS = [
  'full',
  'oculus',
  'round_arch',
  'gothic_arch',
  'rose',
  'stained_glass',
  'four_panes',
  'leaded_diamonds',
  'quatrefoil',
  'octagon',
  'fanlight',
  'paper_screen',
  'porthole',
] as const
export type ShapeId = (typeof SHAPE_IDS)[number]
export const FRAME_MATERIAL_IDS = [
  'oak',
  'spruce',
  'dark_oak',
  'birch',
  'gilded',
  'stone',
  'iron',
  'none',
] as const
export type FrameMaterial = (typeof FRAME_MATERIAL_IDS)[number]
export type PaintingStatus = 'draft' | 'ready' | 'published'
export interface Recipe {
  source: { imageId: string; width: number; height: number } | null
  crop: { x: number; y: number; width: number; height: number }
  rotation: 0 | 90 | 180 | 270
  flipX: boolean
  flipY: boolean
  scaling: 'sharp' | 'smooth'
  adjust: { brightness: number; contrast: number; saturation: number }
  mcLook: { enabled: boolean; colors: number; palette: 'auto' | 'blocks'; dither: boolean }
  window: { shape: ShapeId; glassOpacity: number }
  frame: { material: FrameMaterial; thickness: number }
  editsId: string | null
}
export interface Painting {
  id: string
  title: string
  titleColor: McColor
  author: string
  authorColor: McColor
  width: number
  height: number
  pixelsPerBlock: number
  status: PaintingStatus
  publishedIn?: number
  /**
   * Ids the painting had before a new title moved it (R17), oldest first: a pack shared
   * earlier names it by one of them, and merges recognise it (I4).
   */
  formerIds?: string[]
  createdAt: string
  updatedAt: string
  recipe: Recipe
}
export interface Library {
  formatVersion: 1
  name: string
  namespace: string
  version: number
  /** When the last library pack was built (ISO); absent = never exported. */
  exportedAt?: string
  paintings: Painting[]
}
/** PNG bytes keyed by asset id (source images, edit layers `<id>`, edit masks `<id>.mask`). */
export type Assets = Record<string, Uint8Array>
export interface Workspace {
  library: Library | null
  loose: Painting[]
  assets: Assets
  /** The open library is the built-in demo (sample). Workspace-only, never written to packs. */
  demo?: boolean
  /** Ids of the demo's sample paintings, as built. Workspace-only, never written to packs. */
  demoIds?: string[]
}
export type Random = () => number // returns [0, 1)
