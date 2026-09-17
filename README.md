# KNET Control Panel

A lightweight KNET practice dashboard for Learnability & Comprehension, Problem Solving,
Communication (English), and Psychometric Assessment, powered by Gemini.

## What changed

The existing UI and scoring flow are preserved. Question generation now uses a controlled
blueprint plus a quality-audit loop. Scored questions are checked for:

- genuine reasoning rather than keyword matching
- a single defensible answer
- plausible, mistake-based distractors
- appropriate difficulty and reasoning depth
- self-contained information and consistent explanations

The browser also records response time and generated question metadata alongside the existing
local history. Existing localStorage history remains compatible.

## Deploy to Netlify

1. Upload/push this folder to GitHub, or upload the project to Netlify.
2. Netlify should detect Next.js automatically.
3. Build command: `npm run build`
4. Node version: `20` (already set in `netlify.toml`)
5. Add `GEMINI_API_KEY` as a Netlify environment variable if you want to use one server-side key.
   Alternatively, the existing Settings panel lets a user enter their own Gemini key.

The `/api/generate` App Router endpoint is intentionally kept server-side so the Gemini call is
not made directly from browser JavaScript.

## Local development

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.
