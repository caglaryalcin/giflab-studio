# GifLab Studio

Local GIF archive studio for browsing, collecting, editing, and exporting GIF variants.

## What It Does

- Scans GIF files from `public/gif-archive`
- Keeps a catalog index and generated previews in `data/cache`
- Shows indexing progress on `/status`
- Detects editable colors and previews recolors quickly
- Supports light, regular, and bold stroke presets
- Exports edited GIFs with size, delay, loop, and background options
- Includes light and dark interface themes

## Commands

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
```

## Add GIFs

Put GIF files in:

```text
public/gif-archive
```

Then refresh the archive from the app.

## Docker

Build the image:

```powershell
docker build -t giflab-studio .
```

GitHub Actions publishes pushes on `main` to GitHub Container Registry:

```powershell
docker pull ghcr.io/<owner>/<repo>:latest
```

Run it with your local GIF archive mounted into the container:

```powershell
docker run --rm -p 3000:3000 -v "${PWD}\public\gif-archive:/app/public/gif-archive:ro" giflab-studio
```

For larger archives, mount a writable cache volume too:

```powershell
docker run --rm -p 3000:3000 `
  -v "${PWD}\public\gif-archive:/app/public/gif-archive:ro" `
  -v "${PWD}\data\cache:/app/data/cache" `
  giflab-studio
```

The container reads GIFs from `/app/public/gif-archive`, mapped from your local `public\gif-archive` folder. It stores the catalog manifest, poster cache, color analysis, and preview data in `/app/data/cache`.
