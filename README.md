# Yomi

A modern, voice-activated teleprompter that runs entirely in your browser. Paste your script, hit the mic, and Yomi follows along as you speak, highlighting the words you've already said and keeping your place on screen.

Inspired by [jlecomte/voice-activated-teleprompter](https://github.com/jlecomte/voice-activated-teleprompter), rebuilt with Next.js, React 19 and on-device Whisper.

## Features

- **Follows your voice.** Speech is fuzzy-matched against your script (tokenizer plus Levenshtein distance), so skipped words, ad-libs and small stumbles don't lose your place.
- **Two speech engines.**
  - **Web Speech API:** fast and zero-setup in Chromium browsers.
  - **Whisper (local):** runs `onnx-community/whisper-base` on WebGPU through [Transformers.js](https://github.com/huggingface/transformers.js), so audio never leaves your machine.
- **Markdown scripts.** Headings, bold, italics and lists render in prompter mode (toggleable).
- **Readable display.** Adjustable font size, family, weight, zoom and scroll offset.
- **Saved scripts.** Your draft and named scripts are kept in `localStorage`.
- **Light and dark themes.**

## Keyboard shortcuts (prompter mode)

| Key | Action |
| --- | --- |
| `Space` | Start or stop listening |
| `Left` / `Right` | Move back or forward 5 words |
| `Up` / `Down` | Move back or forward 15 words |
| `Esc` | Stop and return to edit mode |

## Getting started

```bash
bun install      # or npm install
bun dev          # or npm run dev
```

Open [http://localhost:3000](http://localhost:3000), paste your script in **Edit**, switch to **Prompter**, and press the mic.

### Requirements

- A Chromium-based browser (Chrome, Edge, Arc) for the Web Speech API.
- WebGPU support for the local Whisper engine. The model downloads once on first use and is cached.
- Microphone permission.

## Scripts

| Command | Description |
| --- | --- |
| `dev` | Start the dev server |
| `build` | Production build |
| `start` | Serve the production build |
| `lint` | Run ESLint |
| `typecheck` | Run the TypeScript compiler |
| `format` | Format with Prettier |

## Project structure

```
app/                 Next.js app (main teleprompter UI in page.tsx)
components/ui/       shadcn/ui components
lib/tokenizer.ts     Splits scripts into word tokens
lib/speech-matcher.ts Matches spoken text to the script position
lib/levenshtein.ts   Fuzzy word distance
lib/markdown.ts      Markdown parsing for prompter rendering
public/whisper-worker.js  Web Worker running Whisper on WebGPU
```

## Tech stack

Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, Transformers.js.