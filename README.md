<p align="center">
  <img src="app-icon.png" width="120" alt="Kamiko" />
</p>

<h1 align="center">Kamiko</h1>

<p align="center">
  An AI VTuber you can talk to in the browser — 3D VRM avatar, voice chat,
  and an emotion engine that reacts in real time.
</p>

<p align="center">
  <a href="https://kamiko.fun">kamiko.fun</a>
</p>

## What this is

Kamiko is a live, interactive 3D AI VTuber web app. You talk to her by voice or
text and she replies with synthesized speech, lip-sync, and emotion-driven
facial expressions on a 3D VRM avatar, right in the browser.

This repository is the actual application code that runs **kamiko.fun** — not
a stub or a demo.

## This is a fork

Kamiko is built directly on top of **[Amica](https://github.com/semperai/amica)**
by Semper AI / pixiv Inc — an open source interface for talking to 3D VRM
characters with voice synthesis and speech recognition. Amica's React/Next.js
VTuber shell (3D rendering via three.js/@pixiv/three-vrm, speech recognition,
emotion-driven expressions, TTS backends) is the foundation this product is
built on, per Amica's MIT license.

A number of framework-agnostic capabilities (statistical idle motion,
viseme/lip-sync driving, streaming TTS chunking, the wake/send pipeline) are
ported from **[AIRI](https://github.com/moeru-ai/airi)** by moeru-ai, also
MIT licensed. See [`src/airi/README.md`](./src/airi/README.md) for exactly
which AIRI packages are wired in and which were tried and removed.

Both upstream projects are MIT licensed; this repository keeps the MIT
license and the original copyright notices (see [LICENSE](./LICENSE)), as
required.

### What Kamiko changed on top of Amica/AIRI

- Replaced Amica's generic persona/brand with Kamiko's own character,
  avatar look (heterochromia "only-half-awake" eye glow,
  `src/features/vrmViewer/kamikoLook.ts`), and voice.
- Wired the chat backend to Kamiko's own agent/brain service (OpenAI-compatible
  endpoint) instead of Amica's default backend options.
- De-branded Amica/Arbius references across the UI, landing/funnel pages, and
  SEO metadata (title, `og:site_name`, JSON-LD) to Kamiko's own brand.
- Added crawlable marketing/funnel pages, SEO edge routing (www/https
  redirects), and analytics/conversion tracking around the live app.
- Ported in and wired a small set of AIRI capabilities (idle motion,
  lip-sync, streaming TTS chunking) on top of Amica's rendering stack.
- Face tracking (webcam → ARKit blendshapes → VRM expressions) was written
  fresh for this product rather than ported from either upstream.

The avatar model currently shipped is a placeholder VRM (see
[`MODEL.md`](./MODEL.md)); a custom authored Kamiko VRM is tracked there.

## Running it locally

```bash
git clone https://github.com/caelum0x/kamiko.git
cd kamiko
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). Configuration is
via `.env.local` — see `.env.example` and `src/utils/config.ts` for available
options (this mirrors Amica's own configuration approach).

## License

MIT — see [LICENSE](./LICENSE). Original copyright Semper AI / pixiv Inc for
the Amica codebase this is forked from, and moeru-ai for the ported AIRI
packages noted above. Kamiko-specific code and branding added on top is
likewise MIT licensed.

## Links

- Live app: [kamiko.fun](https://kamiko.fun)
- Upstream (Amica): [github.com/semperai/amica](https://github.com/semperai/amica)
- Upstream (AIRI): [github.com/moeru-ai/airi](https://github.com/moeru-ai/airi)
