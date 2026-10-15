import { useRef } from 'react'
import type { Recipe } from '../../../domain/types.ts'
import { format, useT } from '../../../i18n/i18n.ts'
import { fileToRaster } from '../../../imaging/decode.ts'
import { encodePng } from '../../../packs/png.ts'
import { NO_CROP, useEditor } from '../../../state/editor.ts'
import { useWorkspace } from '../../../state/workspace.ts'
import { Button } from '../../../ui/Button.tsx'
import { errorMessage } from '../../../ui/errors.ts'
import { FileDrop } from '../../../ui/FileDrop.tsx'
import { Icon, type IconName } from '../../../ui/Icon.tsx'
import { Segmented } from '../../../ui/Segmented.tsx'
import { Slider } from '../../../ui/Slider.tsx'
import { toast } from '../../../ui/toastStore.ts'
import styles from './steps.module.css'

const IMAGE_TYPES = 'image/*'

type Adjust = Recipe['adjust']
type McLook = Recipe['mcLook']

/** Applies a recipe patch; slider drags pass a merge key so one drag is one undo step. */
function patchRecipe(patch: (r: Recipe) => Partial<Recipe>, merge?: string) {
  useEditor
    .getState()
    .change((p) => ({ ...p, recipe: { ...p.recipe, ...patch(p.recipe) } }), { merge })
}

/** A new rotation or flip leaves the crop meaningless: it goes back to the centred crop. */
function turn(patch: (r: Recipe) => Partial<Recipe>) {
  patchRecipe((r) => ({ ...patch(r), crop: { ...NO_CROP } }))
}

export function ImageStep() {
  const t = useT()
  const recipe = useEditor((s) => s.painting?.recipe)
  const fileInput = useRef<HTMLInputElement>(null)
  if (!recipe) return null
  const { source, adjust, mcLook } = recipe

  async function loadPicture(file: File) {
    try {
      const raster = await fileToRaster(file)
      const imageId = useWorkspace.getState().putAsset(encodePng(raster))
      useEditor.getState().setSource(raster, imageId)
    } catch (error) {
      toast(errorMessage(error, t), 'error')
    }
  }

  const setAdjust = (key: keyof Adjust) => (value: number) =>
    patchRecipe((r) => ({ adjust: { ...r.adjust, [key]: value } }), `adjust.${key}`)
  const setLook = (patch: Partial<McLook>, merge?: string) =>
    patchRecipe((r) => ({ mcLook: { ...r.mcLook, ...patch } }), merge)

  const turns: Array<{ icon: IconName; label: string; run(): void }> = [
    {
      icon: 'rotate-left',
      label: t.editor.image.rotateLeft,
      run: () => turn((r) => ({ rotation: ((r.rotation + 270) % 360) as Recipe['rotation'] })),
    },
    {
      icon: 'rotate-right',
      label: t.editor.image.rotateRight,
      run: () => turn((r) => ({ rotation: ((r.rotation + 90) % 360) as Recipe['rotation'] })),
    },
    { icon: 'flip-x', label: t.editor.image.flipX, run: () => turn((r) => ({ flipX: !r.flipX })) },
    { icon: 'flip-y', label: t.editor.image.flipY, run: () => turn((r) => ({ flipY: !r.flipY })) },
  ]

  return (
    <FileDrop
      accept={IMAGE_TYPES}
      fullWindow
      onFiles={([file]) => {
        if (file) void loadPicture(file)
      }}
    >
      <section className={styles.section}>
        <h2 className={styles.heading}>{t.editor.image.heading}</h2>
        <div className={styles.dropZone}>
          <p className={styles.hint}>
            {source
              ? format(t.editor.image.pictureSize, { width: source.width, height: source.height })
              : t.editor.image.noPicture}
          </p>
          <p className={styles.hint}>{t.editor.image.hint}</p>
          <Button icon="image" onClick={() => fileInput.current?.click()}>
            {source ? t.editor.image.replace : t.editor.image.browse}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept={IMAGE_TYPES}
            hidden
            aria-label={t.editor.chooseImage}
            onChange={(event) => {
              const [file] = Array.from(event.target.files ?? [])
              event.target.value = ''
              if (file) void loadPicture(file)
            }}
          />
        </div>
      </section>

      <hr className={styles.separator} />

      <section className={styles.section} aria-labelledby="image-turn">
        <h3 id="image-turn" className={styles.subheading}>
          {t.editor.image.turn}
        </h3>
        <div className={styles.row}>
          {turns.map((b) => (
            <button
              key={b.icon}
              type="button"
              className={styles.iconButton}
              aria-label={b.label}
              title={b.label}
              onClick={b.run}
            >
              <Icon name={b.icon} size={18} />
            </button>
          ))}
        </div>
      </section>

      <hr className={styles.separator} />

      <section className={styles.section} aria-labelledby="image-adjust">
        <h3 id="image-adjust" className={styles.subheading}>
          {t.editor.image.adjustments}
        </h3>
        <Slider
          id="adjust-brightness"
          label={t.editor.image.brightness}
          min={-100}
          max={100}
          value={adjust.brightness}
          onChange={setAdjust('brightness')}
        />
        <Slider
          id="adjust-contrast"
          label={t.editor.image.contrast}
          min={-100}
          max={100}
          value={adjust.contrast}
          onChange={setAdjust('contrast')}
        />
        <Slider
          id="adjust-saturation"
          label={t.editor.image.saturation}
          min={-100}
          max={100}
          value={adjust.saturation}
          onChange={setAdjust('saturation')}
        />
      </section>

      <hr className={styles.separator} />

      <section className={styles.section} aria-labelledby="image-look">
        <div className={styles.between}>
          <label id="image-look" htmlFor="mc-look" className={styles.subheading}>
            {t.editor.image.mcLook}
          </label>
          <input
            id="mc-look"
            type="checkbox"
            role="switch"
            className={styles.switch}
            checked={mcLook.enabled}
            onChange={(event) => setLook({ enabled: event.currentTarget.checked })}
          />
        </div>
        <p className={styles.hint}>{t.editor.image.mcLookHint}</p>
        {mcLook.enabled && (
          <>
            <Segmented
              label={t.editor.image.palette}
              options={[
                { value: 'auto', label: t.editor.image.paletteAuto },
                { value: 'blocks', label: t.editor.image.paletteBlocks },
              ]}
              value={mcLook.palette}
              onChange={(palette) => setLook({ palette })}
            />
            {mcLook.palette === 'auto' && (
              <Slider
                id="mc-colors"
                label={t.editor.image.colors}
                min={2}
                max={64}
                value={mcLook.colors}
                onChange={(colors) => setLook({ colors }, 'mcLook.colors')}
              />
            )}
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={mcLook.dither}
                onChange={(event) => setLook({ dither: event.currentTarget.checked })}
              />
              {t.editor.image.dither}
            </label>
          </>
        )}
      </section>
    </FileDrop>
  )
}
