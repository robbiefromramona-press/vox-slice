# BUILD_STATE

Vox-Slice is **free, open source (MIT) and public**. Everyone gets the full tool.

## Setup
- Hosting: Cloudflare Pages (`vox-slice.pages.dev`), build `npm run build`, output `dist`, Node 22 (`.node-version`).
  `public/_headers` supplies the security headers and the COOP/COEP isolation headers. No Netlify features are used.
- `scripts/prune-dist.mjs` runs after the build: it deletes the unused ~25 MB `ort-wasm-simd-threaded.asyncify-*.wasm`
  and fails the build if any file is over Cloudflare's 25 MiB limit.
- No password gate. `extras/password-gate/` keeps the old Netlify edge function and how to switch it back on.
- `src/tier.js`: `FREE_FOR_ALL = true` makes `getUserTier()` return 'pro' for everyone. The 20-second free tier,
  Go Pro banner, tier label and How-to note are dormant (UI nodes tagged `data-tier-ui` are removed while the switch is on).
- `/pricing` is the "free and open source" page with a plain Ko-fi link (`https://ko-fi.com/robbiefromramona`, new tab,
  no Ko-fi scripts). The same link is in the app footer, on `/credits`, and in a small dismissible line after an export.
- `/credits` (`credits.html`) lists every library, font, model and artwork with its license and explains the one
  copyleft piece (LGPL-3.0 MP3 encoder). Update it whenever a dependency changes.
- Brand: asset pack v1.0 is copied into `public/brand/` (never link to the concept-art folder). `tests/e2e/shots.mjs`
  makes the before/after screenshots in `docs/`. e2e runs on any engine: `BROWSER=chromium|msedge|firefox|webkit|iphone`.
- Footer link: Report a bug / Suggest a feature goes to GitHub Issues.

## Testing
- `npm test`: unit tests. `npm run build && npm run serve:dist`, then `npm run test:e2e` (production build, real headers).
- Browser checks must show zero CSP errors in the console, and transcription must be multi-threaded (`crossOriginIsolated`).
