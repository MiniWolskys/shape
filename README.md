# Shape · Minecraft paintings

Design custom Minecraft paintings in your browser, shape them like windows, and export a ready-to-use library pack for your server.

**Use it:** https://miniwolskys.github.io/shape/

- Runs entirely in the browser. No account, no upload, nothing stored on the site.
- Window shapes (arches, rose windows, stained glass…) with real transparency, for use with the Transparent Paintings mod.
- One export file holds the library, the datapack, the resource pack and its SHA1.
- English and French.

Built for Minecraft 26.3.

## Screens

- **Home**: resume your work, create a painting, open a library pack, start a new library, or try the demo library. "How it works" explains the three steps.
- **Library**: every painting with its badge (Draft, Ready, Changed, Published), filters, search, duplicate and delete. Paintings made outside the library are listed below it, each with "Add to {library}". Import any library pack: a pack of another library adds its paintings as new ones, after you confirm.
- **Editor**: five steps you can visit in any order: Image, Size & crop, Window & frame, Colors & pixels, Details. Your work saves itself as you go.
- **Export**: the button says what it does ("Publish 2 and download v3"; with nothing new, "Download v2 again" or "Download a backup"), then copy the server settings.

## How to use it

### Create a painting

1. On the home screen, choose **Create a painting**. You don't need a library yet.
2. **Image**: drop, paste or browse for a picture. Turn, flip and adjust it, or turn on the Minecraft look for fewer colors.
3. **Size & crop**: pick the size in blocks (1 to 16 per side) and the pixels per block (16, 32, 64 or custom). Drag or use the arrow keys to move the crop.
4. **Details**: give it a title and an author and pick their colors. **Include in the next export** is on by default; turn it off to keep a draft.
5. Your work saves itself in the browser as you go (Ctrl+S saves right away).

### Window and frame

In **Window & frame**, pick a shape. Everything outside the shape becomes see-through in game. Set the glass opacity, then the frame material and thickness. The frame follows the window outline. Wooden bars use the same thickness; lead lines keep their own.

Use the canvas views to check the result: **Editor**, **On the wall** and **Without the Transparent Paintings mod** (what players without the mod see: the frame color instead of see-through).

### Pixels

In **Colors & pixels**, paint over the result with the pencil (B), fill (G), replace color (R), magic wand (W), eyedropper (I) and eraser (E). Pick **Transparent** or a glass preset to make pixels see-through. With the magic wand, click an area (Shift adds to the selection), then **Apply to selection**. Undo with Ctrl+Z, redo with Ctrl+Y.

### Export

1. Start a library (just a name; its pack ID is under Advanced), or open your last library pack. Paintings you made outside a library are listed below it, ready to add.
2. Choose **Export**. Ready paintings with a picture are ticked; the button says how many it publishes and which version it downloads (`<namespace>-v<version>.zip`). With nothing new, it downloads the same version again (the server files are exactly those of that version), or, when you have unpublished paintings, a backup `<namespace>-v<version>-backup.zip` that keeps them; neither publishes anything.
3. Keep that one file: it is your backup, and you can share it with friends.

Closing a library, or replacing it with a new one or the demo, deletes its paintings from the browser. Shape tells you first how many haven't been exported and offers to export them.

Published paintings can't be deleted, resized or renamed (their ID), because placed copies would disappear from your world. Their title, author and picture can still change.

### On the server

0. Every player needs the Transparent Paintings mod to see through the windows. Without it, they see the frame color.
1. Unzip the library pack, and upload `server/<namespace>-datapack.zip` to `world/datapacks/` on your server.
2. Upload `server/<namespace>-resources.zip` to a host that gives a direct download link (a link to the file itself, not to a page about it).
3. Set these lines in `server.properties`, with your link and the SHA1 shown on the export screen (also in `server/sha1.txt`):

   ```properties
   resource-pack=<your direct link>
   resource-pack-sha1=<sha1>
   require-resource-pack=true
   ```

4. Restart the server. `/reload` is not enough.

## What's inside the library pack

```
<namespace>-v<version>.zip
  shape-library.json              the library: paintings with their settings (no pictures)
  images/<imageId>.png            source pictures
  edits/<editsId>.png             pixel edits: the color of each edited pixel
  edits/<editsId>.mask.png        which pixels are edited
  textures/<paintingId>.png       the finished painting textures
  server/<namespace>-datapack.zip
  server/<namespace>-resources.zip
  server/sha1.txt                 SHA1 of the resource pack
  server/README.txt               server steps in English and French
```

The same content always gives the same bytes, so an unchanged resource pack keeps its SHA1.

## Development

Requires Node 22 or later.

```bash
npm install
npm run dev
```

The dev server runs at http://localhost:5173/shape/.

| Command             | What it does                                               |
| ------------------- | ---------------------------------------------------------- |
| `npm run dev`       | Start the dev server                                       |
| `npm test`          | Run the unit tests                                         |
| `npm run lint`      | Lint with oxlint                                           |
| `npm run typecheck` | Type-check                                                 |
| `npm run format`    | Format with Prettier                                       |
| `npm run build`     | Production build into `dist/`                              |
| `npm run preview`   | Serve the production build at http://localhost:4173/shape/ |

Every push to `main` is checked and deployed to GitHub Pages by `.github/workflows/ci.yml`.

## License

MIT
