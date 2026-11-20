# Vox-Slice

**Chop the speech. Keep the fire.** Free and open source, from [Fire-Press](https://fire-press.netlify.app).

**Live:** https://vox-slice.pages.dev

![Vox-Slice turning a speech into clickable words](docs/screenshot.webp)

Drop in a speech (MP3, WAV or M4A, up to 15 minutes). Vox-Slice writes out every word with its
timing. Click or drag across the words you want, turn them into clips, fine-tune the edges on the
waveform, and download them as WAV and/or MP3, one by one or all in a ZIP.

**It runs in your browser. Nothing is uploaded.** Your audio and transcripts never leave your
computer. There is no account and no server. (The speech model, about 75 MB, is downloaded once
from huggingface.co and then cached by your browser.)

## What it does

- Speech-to-text in the browser (Whisper via transformers.js, in a background worker) with word-level timings.
- A transcript you can click, drag and search. Clips with draggable start/end handles on a waveform.
- Export WAV, MP3 or both, in a ZIP with a `manifest.csv`. Optional loudness evening and silence trimming.
- Save/load project files; transcripts are remembered in the browser.
- A library of several speeches with search across all of them.
- Sentence Builder: type lyric lines, it finds each word in your library and stitches the line.
- Rhyme finder, and an "AI Rap Pack" flow: copy a ready-made prompt, paste an AI's phrase list back in, and get every matching take.

## Run it on your computer

You need [Node.js](https://nodejs.org) 22 or newer.

```
npm install
npm run dev
```

Then open http://localhost:5184 in Chrome (other browsers work but can be slower).

Other commands: `npm test` (unit tests), `npm run build` (production build into `dist/`),
`npm run serve:dist` (serves `dist/` with the real security headers on port 5190; then `npm run test:e2e`).

## Report a bug or suggest a feature

[Open an issue](https://github.com/robbiefromramona-press/vox-slice/issues/new/choose). Please do not
attach private audio; describe what happened and your browser instead. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Support

Vox-Slice is free. If it helps you, you can [support it on Ko-fi](https://ko-fi.com/robbiefromramona) (a plain link, no scripts).
Every library, font, model and image it uses is listed on the [credits page](https://vox-slice.pages.dev/credits).

## How it is built

Vite + plain JavaScript. See [ARCHITECTURE.md](ARCHITECTURE.md). All "who may do what" logic is in
`src/tier.js`; the `FREE_FOR_ALL` switch there is on, so everyone gets the full tool (the old
20-second free limit is kept dormant in the code). Hosting is Cloudflare Pages, and `public/_headers`
holds the security headers (cross-origin isolation for multi-threaded transcription, CSP and so on).

## License

[MIT](LICENSE) (c) Fire-Press. The optional password gate in `extras/password-gate/` is
adapted from MIT-licensed community code.
