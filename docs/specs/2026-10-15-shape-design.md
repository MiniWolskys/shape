# Shape · design spec

Date: 2026-10-15 · Status: approved for implementation

Shape is a static web app for a small group of Minecraft 26.3 players. It turns pictures into custom
paintings, cuts them into window shapes with real transparency, and exports one **library pack**
that holds everything the server needs. The visual design reference is
[`docs/design/design-proposal.html`](../design/design-proposal.html) (direction A, Lantern Workshop,
Dusk tone; the page still uses the older working names).

## 1. Decisions

| Topic               | Decision                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Name                | **Shape**, tagline “Minecraft paintings” / « tableaux Minecraft »                                                                      |
| Hosting             | GitHub Pages, `https://miniwolskys.github.io/shape/`, deployed by GitHub Actions                                                       |
| Backend             | None. No login, no upload. Everything runs and stays in the browser.                                                                   |
| Look                | Lantern Workshop, Dusk tone only. Paintings always sit on a neutral grey, never on brown.                                              |
| Languages           | English and French. Browser language on first visit, switch in the top bar, remembered.                                                |
| Export              | One file, the **library pack**, a plain `.zip` (`<namespace>-v<version>.zip`).                                                         |
| Published paintings | Locked size, ID and existence. Title, author and image can still change.                                                               |
| Optional features   | Basic image editing and the Minecraft look filter are in v1.                                                                           |
| Desktop first       | Editing is designed for mouse and keyboard; phones can browse and export (a dismissible notice says editing works best on a computer). |

## 2. Minecraft facts (from the 26.3 test packs)

- Data pack `pack.mcmeta`: `{"pack": {"description": …, "min_format": 121, "max_format": 121}}`.
- Resource pack `pack.mcmeta`: `{"pack": {"description": …, "min_format": 97, "max_format": [97, 1]}}`.
- Painting variant: `data/<ns>/painting_variant/<id>.json` with `asset_id`, `width`, `height` (blocks,
  1–16), `title` and `author` as text components `{ "text", "color" }`.
- Texture: `assets/<ns>/textures/painting/<id>.png`, width × height blocks at N px per block.
- Every painting is listed in `data/minecraft/tags/painting_variant/placeable.json` with
  `"replace": false`.
- Transparency is shown in game by the Transparent Paintings mod. Without it, players see the RGB of
  transparent pixels, so Shape fills those with the frame color.

All pack format numbers live in one module so a Minecraft update is a one-line change.

## 3. Domain model

```ts
type McColor = 'black' | 'dark_blue' | … | 'white' // the 16 named text colors

interface Library {
  formatVersion: 1
  name: string           // display name, e.g. "Our paintings"
  namespace: string      // [a-z0-9_.-]+, e.g. "ourpaintings"
  version: number        // 0 before the first export, +1 on every export that publishes or updates
  exportedAt?: string    // ISO time of the last export; absent = never exported
  paintings: Painting[]
}

interface Painting {
  id: string             // [a-z0-9_]+, slug of the title + "_" + 3 base36 chars; follows the title until published, then never changes
  title: string; titleColor: McColor
  author: string; authorColor: McColor
  width: number; height: number          // blocks, 1..16
  pixelsPerBlock: number                 // 16 | 32 | 64 | custom 1..64
  status: 'draft' | 'ready' | 'published'
  publishedIn?: number                   // library version of first export
  createdAt: string; updatedAt: string   // ISO
  recipe: Recipe                         // everything needed to re-render and re-edit
}

interface Recipe {
  source: { imageId: string; width: number; height: number } | null
  crop: { x: number; y: number; width: number; height: number }   // in rotated source pixels
  rotation: 0 | 90 | 180 | 270; flipX: boolean; flipY: boolean
  scaling: 'sharp' | 'smooth'
  adjust: { brightness: number; contrast: number; saturation: number }   // -100..100
  mcLook: { enabled: boolean; colors: number; palette: 'auto' | 'blocks'; dither: boolean }
  window: { shape: ShapeId; glassOpacity: number }                       // 0..1
  frame: { material: FrameMaterial; thickness: number }                  // px at this resolution
  editsId: string | null                                                 // pixel edit layer
}
```

Binary data (source images, edit layers, rendered textures) is stored separately from the JSON,
keyed by ID, both in IndexedDB and in the library pack.

**Library rules**

- A painting gets `status: 'published'` when it is included in an export. Published paintings are
  in every later export and cannot be deleted; their size and ID cannot change.
- New paintings start `ready` (“Include in the next export” on); `draft` keeps one out of exports.
  A published painting edited after `exportedAt` is **changed**: the server copy is out of date.
- Importing a pack of the same library (same namespace) only adds paintings whose ID is not already
  present. Same-ID paintings keep the local copy unless the incoming one is published and the local
  one is not.
- Importing a pack of another library adds its paintings to the open one as new, unpublished, ready
  copies (fresh IDs), after a confirm naming the source library and the count. With no library open,
  or with the demo open, the pack is opened instead (the demo is replaced, after the close confirm
  when it was changed). Re-importing a pack that adds nothing says so.
- A painting is **unexported** when no downloaded pack holds it as it is now: every painting of a
  never-exported library, else unpublished and changed ones. Closing or replacing a library deletes
  its paintings, so Close library, Start a new library and Try the sample library name the count of
  unexported paintings first, offer “Export first”, and delete only through a red “Delete {n} and
  close”. With nothing to lose they are a plain confirm.
- A painting created without a library (“loose painting”) lives in the workspace. With a library open,
  loose paintings are listed under it in “Not in this library”, each with “Add to {library}”.
- The sample library is a **demo**: its titles follow the language it was opened in, a banner says so,
  and it can't be exported. A workspace-only flag marks it (never written to packs).
- Renaming an unpublished painting changes its ID: a friend's copy of the old ID becomes a second
  painting on a later merge.

## 4. Library pack format

```
<namespace>-v<version>.zip
  shape-library.json              Library JSON (paintings with recipes, no binary data)
  images/<imageId>.png            source images, re-encoded as PNG
  edits/<editsId>.png             pixel edit layer: the RGBA value of each edited pixel
  edits/<editsId>.mask.png        which pixels are edited (white = edited, black = untouched)
  textures/<paintingId>.png       final rendered textures
  server/<namespace>-datapack.zip
  server/<namespace>-resources.zip
  server/sha1.txt                 SHA1 of the resources zip, lowercase hex
  server/README.txt               server steps in English and French
```

- Zips are written with fixed timestamps and sorted entries, so the same content always gives the
  same bytes and the same SHA1.
- Opening a file checks for `shape-library.json` and `formatVersion`; anything else gets a clear
  error. Unknown future `formatVersion` values are refused with “made by a newer Shape”.

## 5. Rendering pipeline

Pure functions over a small `Raster { width, height, data: Uint8ClampedArray }` type, so everything
except image decoding runs in unit tests without a browser. Heavy renders run in a Web Worker.

1. **Picture:** decode source → rotate/flip → crop → resample to `width × height × pixelsPerBlock`
   (nearest for sharp, area-average for smooth) → brightness/contrast/saturation → optional
   Minecraft look (median-cut to N colors or snap to a fixed block palette, optional
   Floyd–Steinberg dithering).
2. **Window & frame:** for each pixel, the shape function returns `out | frame | lead | glass`
   (+ optional tint). `out` → alpha 0, RGB = frame color. `frame` → frame material color with a
   small deterministic wood/metal grain. `lead` → lead color. `glass` → picture color, alpha =
   glassOpacity (tinted shapes blend 50 % with the pane tint). Frame thickness 0 or material
   “none” draws no frame; lead lines and bars keep their own width.
3. **Pixel edits:** an RGBA layer plus a mask; masked pixels replace the result of steps 1–2.
   Changing shape, crop or adjustments keeps the edits. Changing size or resolution resamples the
   edit layer with nearest-neighbour after a confirmation.

Shapes (§ catalogue in the design page): full painting, oculus, round arch, gothic arch, rose window,
stained glass, four panes, leaded diamonds, quatrefoil, octagon, fanlight, paper screen, porthole.
Frame materials: oak, spruce, dark oak, birch, gilded, stone, iron, none.

## 6. Screens

All copy exists in English and French. Visual reference: the design page, Dusk tone.

1. **Home.** Headline “_Shape_ any picture into a painting you can see through.” / « _Façonnez_ vos
   images en tableaux-fenêtres. » (first word in orange). **Resume** comes first when the browser holds
   work, with the latest painting's thumbnail and “saved {time} ago”. Actions: **Create a painting**
   (“Goes into {library}” when one is open), **Open a library pack** (button + drop anywhere; names
   `<ns>-v<n>.zip` only once a version was exported), **Start a new library** (a name; the pack ID
   under Advanced, fixed after the first export), **Try the sample library**. A wall preview of a
   gothic window painting, and “How it works”: make a painting → collect them in a library → export
   one file for your server, what a library pack is, and that players need the Transparent Paintings
   mod. A picture dropped on Home or Library starts a new painting with it.
2. **Library.** Card grid with Draft · Ready · Changed · Published badges and the same filter chips
   (All · Ready · Draft · Published), search, duplicate (a “(copy)” right after the original,
   highlighted, with an Edit toast), delete (published cards say why they can't). Loose paintings in
   their own foldable section. Import any library pack. The export button says “Export · {n} ready”
   (+ “· {m} changed”) and is the primary button only when that is above zero. An empty library
   offers a first painting or a pack.
3. **Editor**, five steps in a rail, all clickable: Image, Size & crop, Window & frame, Colors &
   pixels, Details. Canvas views: Editor, On the wall, Without the mod. Backdrop: Auto, Light, Dark,
   Sky (Auto contrasts with the frame luminance). Zoom, pixel grid. Undo/redo for every change.
   - Image: drop, browse or paste; rotate/flip; brightness/contrast/saturation; Minecraft look.
   - Size & crop: 16 × 16 block grid picker + presets; resolution 16/32/64/custom; sharp/smooth;
     ratio-locked crop box (drag, wheel zoom).
   - Window & frame: shape grid rendered from this painting, glass opacity, frame material and
     thickness.
   - Colors & pixels: tools pencil (B), fill (G), replace color (R), magic wand (W), eyedropper
     (I), eraser to transparent (E); tolerance; color picker (hue, shade, opacity, hex); presets
     Transparent, Glass 25 %, Glass 50 %, frame color, 16 dye colors; apply to selection.
   - Details: title, author, Minecraft text colors, in-game tooltip preview, “Include in the next
     export”, the ID it will have (or has, once published).
   - The editor opens on a draft that joins the workspace on its first change, saves itself
     (debounced, and on leave; Ctrl+S saves now), sizes a painting to its first picture (1–4 blocks
     per side), and needs a picture before any pixel editing.
4. **Export.** Ready paintings with a picture are ticked; changed and published ones are always in.
   Validation (blocking: no image, duplicate ID; warnings: no title, no author), version
   `vN → vN+1`, contents of the pack. The one button says what it does: “Publish {n} and download
   v{v}” (with “Published paintings can't be resized or deleted later”), “Update {m} and download
   v{v}”. With nothing new, either “Download v{v} again” when every painting is exported (the very
   same file), or “Download a backup” (`<ns>-v{v}-backup.zip`, keeping the unpublished paintings;
   the server files stay those of v{v}); neither publishes anything or changes the version. Then “Your download of {file} started” and “Didn't get the file?
   Download again”. SHA1 and `server.properties` lines with copy, server steps (the mod, the exact
   files inside the pack, what a direct link is), What's new with “Copy for Discord”. The demo
   can't be exported, and Back waits for a build in progress.

## 7. Persistence

The whole workspace (library, loose paintings, binaries) autosaves to IndexedDB, debounced; the UI
language is kept in localStorage. The screen is in the URL (`#/library`, `#/edit/<id>`, `#/export`),
so Back, Forward and reloads follow it. Nothing leaves the browser except files the user downloads.

## 8. Architecture

```
src/
  domain/      types, library rules, IDs, validation            (pure, tested)
  imaging/     Raster, resample, adjust, quantize, shapes, frames, compose, edits, tools (pure, tested)
  packs/       pack formats, datapack/resourcepack builders, library pack read/write, sha1 (tested)
  storage/     IndexedDB workspace persistence
  i18n/        typed EN/FR dictionaries + hook
  state/       Zustand stores (workspace, editor with history)
  ui/          shared components (Button, Segmented, Slider, Dialog, Toast, PaintingCanvas…)
  screens/     Home, Library, Editor (+ steps), Export
  workers/     render worker (latest request wins) and library pack worker
  theme/       tokens.css, global.css
```

React rules: function components, hooks, no class components; state in Zustand stores with
selectors; side effects in hooks; components small and focused; CSS Modules plus global tokens;
accessible markup (labels, roles, focus states, keyboard shortcuts that don't fire in text inputs).

## 9. Errors

Every failure has a message that says what happened and what to do: unreadable image, wrong file
type, newer library format, storage full, export failure. Messages never show developer text (the
details go to the console). No silent catches.

## 10. Testing and CI

- Unit tests for all of `domain`, `imaging`, `packs` (including round-trip export → import and a
  check that generated packs match the structure of the 26.3 test packs).
- Component tests for the main flows (create painting, export) with Testing Library.
- CI on every push and PR: format check, oxlint, type-check, tests, build; `main` deploys to Pages.

## 11. Out of scope for v1

Uploading to the server, hosting the resource pack, animated paintings, real-time collaboration,
mobile-first editing.
