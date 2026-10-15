# Shape · Minecraft paintings

Design custom Minecraft paintings in your browser, shape them like windows, and export a ready-to-use library pack for your server.

**Use it:** https://miniwolskys.github.io/shape/

- Runs entirely in the browser. No account, no upload, nothing stored on the site.
- Window shapes (arches, rose windows, stained glass…) with real transparency, for use with the Transparent Paintings mod.
- One export file holds the library, the datapack, the resource pack and its SHA1.
- English and French.

Built for Minecraft 26.3.

## Development

Requires Node 22 or later.

```bash
npm install
npm run dev
```

| Command             | What it does                  |
| ------------------- | ----------------------------- |
| `npm run dev`       | Start the dev server          |
| `npm test`          | Run the unit tests            |
| `npm run lint`      | Lint with oxlint              |
| `npm run typecheck` | Type-check                    |
| `npm run format`    | Format with Prettier          |
| `npm run build`     | Production build into `dist/` |

Every push to `main` is checked and deployed to GitHub Pages by `.github/workflows/ci.yml`.

## License

MIT
