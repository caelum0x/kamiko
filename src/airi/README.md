# airi, merged into amica

The framework-agnostic TypeScript of apps/airi (MIT, https://github.com/moeru-ai/airi), copied here
so $NPC gains airi's capabilities on the amica (React) foundation. Each package's `@proj-airi/*`
imports are repointed at the sibling merged copy; third-party deps are declared in
apps/vtuber-amica/package.json at airi's catalog versions.

WIRED into the product (imported by code that renders):
- `motion/` → the VRM stage's statistical idle (src/features/proceduralAnimation/statisticalIdle.ts),
  now emotion-modulated (emotionMood.ts)
- `lipsync/` → the viseme mouth: wLipSync worklet + shared vowel driver + calibrated profile drive
  the VRM's aa/ee/ih/oh/ou presets (src/features/lipSync/lipSync.ts, visemes.ts)
- stream-kit → ../utils/airiQueue.ts, the game's /wake send pipeline

Present, typechecking, NOT yet imported by product code: `ccc/` (character-card v3 codec),
`pipelines-audio/` (TTS chunking), `server-shared/`. Present but excluded from the typecheck
(broken mechanically-repointed imports): `plugin-protocol/` — kept as the VTuber-control contract
the registry's `plugin` listings are shaped for.

DELETED (2026-09-05, upstream reference stays in apps/airi): better-ws, core-agent, dualsense,
fonts, gamepad, i18n, live2d, mediapipe, memory-pgvector, plugin-sdk, plugin-sdk-tamagotchi,
server-runtime, server-sdk — each either duplicated a service this repo already ships (agent
brain, memory, servers) or targeted hardware/runtimes this product has no surface for
(controllers, webcam tracking, Live2D, airi's Vue/Electron plugin hosts).

NOT here (can't be): the Vue UI apps (Vue can't run in React) and pure build/test tooling.
See ../../../../AIRI-MERGE.md. Build: `cd apps/vtuber-amica && npm install && npm run build`.
