# 2One

2One is a simple, mobile-first video shortener for YouTube Shorts and other short-form video. Choose a target duration of 30 seconds, 59 seconds, 2 minutes, 3 minutes, or a custom length, and process your video in the browser. Video processing stays on your device.

The project began as a way to shorten screen recordings of puzzle games. Their long thinking pauses made them difficult to share as Shorts, so 2One was created to retime still moments while preserving the source frames.

## Languages and pages

- English home: `/`
- Persian home: `/fa/`
- English About: `/about.html`
- Persian About: `/fa/about.html`

English is the default. Use the language link in the header to switch between pages.

## Run locally

Requirements: Node.js 20 or later and pnpm.

```bash
pnpm install
pnpm dev
```

For a production build:

```bash
pnpm build
pnpm preview
```

## GitHub Pages

The workflow in `.github/workflows/pages.yml` builds and deploys the site when changes are pushed to `main`. The repository should be named `2One` so Vite's base path (`/2One/`) matches. In repository settings, set **Settings → Pages → Build and deployment** to **GitHub Actions**.

## Privacy and processing

- The video is processed in browser memory and a temporary WebAssembly filesystem. It is not uploaded.
- On the first processing run, the browser loads the local FFmpeg WebAssembly engine (about 31 MB). A service worker stores the engine files in Cache Storage so later visits can reuse them without another download.
- Browser storage is best-effort by default. Browsers may evict cached data under storage pressure, and users can clear it in site settings. 2One requests persistent storage where supported, but the browser decides whether to grant it.
- Large videos depend on available device memory and browser limits. Processing may take longer on phones.
- The timeline can be retimed to 30 seconds, 59 seconds, 2 minutes, 3 minutes, or a custom duration. A still-moment-only mode shortens pauses without fitting to a target. If moving sections alone exceed the selected target, they are sped up too. Source frames are retained.

## Technology

Vite, FFmpeg WebAssembly, JavaScript, and CSS. No system FFmpeg install or Python packages are required.
