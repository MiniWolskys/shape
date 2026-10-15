import { useId, type CSSProperties } from 'react'
import { defaultRecipe } from '../../../domain/library.ts'
import { FRAME_MATERIAL_IDS, SHAPE_IDS, type Recipe, type ShapeId } from '../../../domain/types.ts'
import { useT } from '../../../i18n/i18n.ts'
import { FRAME_MATERIALS } from '../../../imaging/materials.ts'
import { useEditor } from '../../../state/editor.ts'
import { Backdrop } from '../../../ui/Backdrop.tsx'
import { PaintingCanvas } from '../../../ui/PaintingCanvas.tsx'
import { Slider } from '../../../ui/Slider.tsx'
import { shapeIcon, useShapeThumbnails } from '../shapeThumbnails.ts'
import styles from './steps.module.css'
import own from './WindowStep.module.css'

/** CSS pixels of a shape thumbnail's longest side. */
const THUMB_SIZE = 48
const MAX_THICKNESS = 8
/** What a double-click on a slider puts back. */
const DEFAULTS = defaultRecipe()

function patchRecipe(patch: (r: Recipe) => Partial<Recipe>, merge?: string) {
  useEditor
    .getState()
    .change((p) => ({ ...p, recipe: { ...p.recipe, ...patch(p.recipe) } }), { merge })
}

const endGesture = () => useEditor.getState().endGesture()

/** The shape's line drawing, shown until its thumbnail is drawn (I9). */
function ShapeOutline({ shape }: { shape: ShapeId }) {
  const icon = shapeIcon(shape)
  return (
    <svg
      className={own.icon}
      viewBox={`0 0 ${icon.size} ${icon.size}`}
      width={THUMB_SIZE}
      height={THUMB_SIZE}
      data-placeholder=""
      aria-hidden="true"
    >
      <path d={icon.outline} />
      <path d={icon.lead} />
    </svg>
  )
}

export function WindowStep() {
  const t = useT()
  const id = useId()
  const recipe = useEditor((s) => s.painting?.recipe)
  const thumbnails = useShapeThumbnails()
  if (!recipe) return null
  const { window: win, frame } = recipe

  return (
    <>
      <section className={styles.section} aria-labelledby={`${id}-shape`}>
        <div>
          <h2 id={`${id}-shape`} className={styles.heading}>
            {t.editor.window.heading}
          </h2>
          <p className={styles.hint}>{t.editor.window.hint}</p>
        </div>
        <div className={own.shapes} role="group" aria-label={t.editor.window.heading}>
          {SHAPE_IDS.map((shape) => {
            const thumb = thumbnails[shape]
            const name = t.shapes[shape]
            return (
              <button
                key={shape}
                type="button"
                className={own.shape}
                aria-label={name}
                aria-pressed={win.shape === shape}
                title={name}
                onClick={() => {
                  if (win.shape !== shape) patchRecipe((r) => ({ window: { ...r.window, shape } }))
                }}
              >
                <Backdrop kind="mid" className={own.thumb}>
                  {thumb ? (
                    <PaintingCanvas
                      raster={thumb}
                      scale={THUMB_SIZE / Math.max(thumb.width, thumb.height)}
                      label={name}
                    />
                  ) : (
                    <ShapeOutline shape={shape} />
                  )}
                </Backdrop>
                <span className={own.shapeName} aria-hidden="true">
                  {name}
                </span>
              </button>
            )
          })}
        </div>
        <div onPointerUp={endGesture}>
          <Slider
            id={`${id}-glass`}
            label={t.editor.glassOpacity}
            min={10}
            max={100}
            value={Math.round(win.glassOpacity * 100)}
            defaultValue={Math.round(DEFAULTS.window.glassOpacity * 100)}
            unit="%"
            onChange={(percent) =>
              patchRecipe(
                (r) => ({ window: { ...r.window, glassOpacity: percent / 100 } }),
                'window.glass',
              )
            }
          />
        </div>
      </section>

      <hr className={styles.separator} />

      <section className={styles.section} aria-labelledby={`${id}-frame`}>
        <div>
          <h2 id={`${id}-frame`} className={styles.heading}>
            {t.editor.frame}
          </h2>
          <p className={styles.hint}>{t.editor.window.frameHint}</p>
        </div>
        <div className={styles.between}>
          <h3 className={styles.subheading}>{t.editor.window.material}</h3>
          <b className={own.value}>{t.materials[frame.material]}</b>
        </div>
        <div className={own.materials} role="group" aria-label={t.editor.window.material}>
          {FRAME_MATERIAL_IDS.map((material) => {
            const [r, g, b] = FRAME_MATERIALS[material].color
            return (
              <button
                key={material}
                type="button"
                className={own.material}
                data-none={material === 'none' || undefined}
                style={{ '--swatch': `rgb(${r} ${g} ${b})` } as CSSProperties}
                aria-label={t.materials[material]}
                aria-pressed={frame.material === material}
                title={t.materials[material]}
                onClick={() => {
                  if (frame.material !== material)
                    patchRecipe((rec) => ({ frame: { ...rec.frame, material } }))
                }}
              />
            )
          })}
        </div>
        <div onPointerUp={endGesture}>
          <Slider
            id={`${id}-thickness`}
            label={t.editor.frameThickness}
            min={0}
            // R4: real pixels. A resize to more pixels per block can take it past 8.
            max={Math.max(MAX_THICKNESS, frame.thickness)}
            value={frame.thickness}
            defaultValue={DEFAULTS.frame.thickness}
            unit={t.editor.window.px}
            disabled={frame.material === 'none'}
            onChange={(thickness) =>
              patchRecipe((r) => ({ frame: { ...r.frame, thickness } }), 'frame.thickness')
            }
          />
        </div>
      </section>
    </>
  )
}
